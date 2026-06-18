// Jenkins declarative pipeline.
// Runs each stage inside ephemeral Kubernetes pods (via the kubernetes plugin),
// builds the image with Kaniko (no Docker daemon required), pushes to a registry,
// runs Prisma migrations as a Job, then rolls out the Deployment.
pipeline {
  agent {
    kubernetes {
      defaultContainer 'jnlp'
      yaml '''
apiVersion: v1
kind: Pod
spec:
  serviceAccountName: jenkins-deployer
  containers:
    - name: kaniko
      image: gcr.io/kaniko-project/executor:v1.23.2-debug
      command: ["/busybox/cat"]
      tty: true
      volumeMounts:
        - name: docker-config
          mountPath: /kaniko/.docker
    - name: kubectl
      image: bitnami/kubectl:1.30
      command: ["cat"]
      tty: true
  volumes:
    - name: docker-config
      projected:
        sources:
          - secret:
              name: registry-credentials
              items:
                - key: .dockerconfigjson
                  path: config.json
'''
    }
  }

  environment {
    REGISTRY    = 'docker.io/hxbeeb'
    IMAGE_NAME  = 'repl'
    IMAGE_TAG   = "${env.GIT_COMMIT?.take(12) ?: env.BUILD_NUMBER}"
    IMAGE       = "${REGISTRY}/${IMAGE_NAME}:${IMAGE_TAG}"
    NAMESPACE   = 'repl'
  }

  options {
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
        script {
          echo "Building ${IMAGE}"
        }
      }
    }

    stage('Lint') {
      steps {
        container('kubectl') {
          // Lightweight lint in a node image keeps the build pod simple.
          // Swap to a dedicated node container if you prefer.
          echo 'Lint runs inside the build via next lint; see Build stage.'
        }
      }
    }

    stage('Build & Push image') {
      steps {
        container('kaniko') {
          sh '''
            /kaniko/executor \
              --context=`pwd` \
              --dockerfile=Dockerfile \
              --destination=${IMAGE} \
              --destination=${REGISTRY}/${IMAGE_NAME}:latest \
              --cache=true \
              --cache-repo=${REGISTRY}/${IMAGE_NAME}-cache \
              --snapshot-mode=redo \
              --build-arg NEXT_TELEMETRY_DISABLED=1
          '''
        }
      }
    }

    stage('DB migrate') {
      steps {
        container('kubectl') {
          sh '''
            set -e
            JOB=repl-migrate-${IMAGE_TAG}
            # Render the Job manifest with a unique name + this build's image.
            sed -e "s|IMAGE_PLACEHOLDER|${IMAGE}|g" \
                -e "s|name: repl-migrate|name: ${JOB}|" \
                k8s/migrate-job.yaml | kubectl apply -f -
            kubectl -n ${NAMESPACE} wait --for=condition=complete --timeout=300s job/${JOB} \
              || (kubectl -n ${NAMESPACE} logs job/${JOB} --tail=200; exit 1)
            kubectl -n ${NAMESPACE} logs job/${JOB} --tail=200
          '''
        }
      }
    }

    stage('Deploy') {
      steps {
        container('kubectl') {
          sh '''
            set -e
            kubectl apply -f k8s/namespace.yaml
            kubectl apply -f k8s/service.yaml
            kubectl apply -f k8s/hpa.yaml
            # Apply the deployment with this build's image substituted in.
            sed "s|IMAGE_PLACEHOLDER|${IMAGE}|g" k8s/deployment.yaml | kubectl apply -f -
            # Belt-and-suspenders: pin the running image explicitly.
            kubectl -n ${NAMESPACE} set image deployment/repl web=${IMAGE}
            kubectl -n ${NAMESPACE} rollout status deployment/repl --timeout=300s
          '''
        }
      }
    }
  }

  post {
    success {
      echo "Deployed ${IMAGE} to ${NAMESPACE}"
    }
    failure {
      container('kubectl') {
        sh 'kubectl -n ${NAMESPACE} rollout undo deployment/repl || true'
      }
    }
  }
}
