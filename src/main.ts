import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { settings } from "./lib/stores/settings.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Mount target #app not found");
}

await settings.initialize();
const app = mount(App, { target });

export default app;
