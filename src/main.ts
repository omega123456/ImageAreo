import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { settings } from "./lib/stores/settings.svelte";

const target = document.getElementById("app");
if (!target) {
  throw new Error("Mount target #app not found");
}

const app = mount(App, { target });
void settings.initialize();

export default app;
