export type GeneratedFiles = Record<string, string>;

export type GeneratedApp = {
  files: GeneratedFiles;
  install_commands: string[];
  start_commands: string[];
};

export type RunResult = {
  frontend_url: string;
  backend_url: string;
  sandbox_id: string;
};

export type ProgressState =
  | "idle"
  | "generating"
  | "sandbox"
  | "installing"
  | "starting"
  | "ready"
  | "error";
