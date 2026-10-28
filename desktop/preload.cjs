// Tells the web app it is running inside the Mac app (draggable title bar, traffic-light inset).
const { contextBridge } = require("electron");
contextBridge.exposeInMainWorld("littleaDesktop", true);
