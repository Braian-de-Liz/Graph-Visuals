import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "./styles/tokens.css";
import "./styles/app.css";
import App from "./App";

// Sem React.StrictMode: em desenvolvimento ele monta efeitos duas vezes,
// recriando a cena WebGL e os listeners do watcher.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
