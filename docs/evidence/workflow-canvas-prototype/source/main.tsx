import { createRoot } from "react-dom/client";
import { Canvas } from "./Canvas";
import "../index.css";
import { SAMPLE } from "./sample";
createRoot(document.getElementById("root")!).render(<div className="p-4"><h1 className="text-xl font-bold">Canvas prototype</h1><Canvas graph={SAMPLE} /></div>);
