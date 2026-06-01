import type { ProgressState } from "@/lib/types";

type Step = {
  key: ProgressState;
  label: string;
};

const steps: Step[] = [
  { key: "generating", label: "Generating code..." },
  { key: "sandbox", label: "Spinning up sandbox..." },
  { key: "installing", label: "Installing dependencies..." },
  { key: "starting", label: "Starting servers..." },
  { key: "ready", label: "Your app is live!" }
];

const order = steps.map((step) => step.key);

export function ProgressSteps({ state }: { state: ProgressState }) {
  if (state === "idle") return null;

  const activeIndex = order.indexOf(state);

  return (
    <div className="progress-panel">
      {steps.map((step, index) => {
        const isDone = activeIndex > index || state === "ready";
        const isActive = state === step.key;

        return (
          <div
            key={step.key}
            className={[
              "progress-step",
              isDone ? "progress-step-done" : "",
              isActive ? "progress-step-active" : ""
            ].join(" ")}
          >
            <span>
              {isDone ? "✓" : index + 1}
            </span>
            <strong>{step.label}</strong>
          </div>
        );
      })}
    </div>
  );
}
