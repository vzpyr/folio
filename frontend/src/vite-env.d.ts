declare module "*.css";

interface Window {
  FolioSplash?: {
    ready?: () => void;
    setTheme?: (theme: string) => void;
  };
}
