const { contextBridge, ipcRenderer } = require("electron")
const validChannels = [
	"select-directory",
	"delete-file",
	"restore-file",
	"preview-file",
]

contextBridge.exposeInMainWorld("electron", {
	invoke: (channel, ...args) => {
		const validChannels = ["select-directory", "delete-file", "restore-file"]
		if (validChannels.includes(channel)) {
			return ipcRenderer.invoke(channel, ...args)
		}
		throw new Error(`Unauthorized IPC channel: ${channel}`)
	},
	receive: (channel, func) => {
		const validChannels = [
			"scan-progress",
			"scan-errors",
			"scan-started",
			"scan-complete",
		]
		if (validChannels.includes(channel)) {
			ipcRenderer.on(channel, (event, ...args) => func(...args))
		}
	},
})
