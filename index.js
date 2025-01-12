const { app, BrowserWindow, ipcMain, dialog } = require("electron")
const path = require("path")
const fs = require("fs").promises
const crypto = require("crypto")
const { shell } = require("electron")

let mainWindow = null

// Constants
const IGNORE_PATTERNS = [
	/node_modules/,
	/\.git/,
	/\.asar$/,
	/^\./, // Hidden files/directories
	/\$Recycle\.Bin/,
	/System Volume Information/,
]

const CHUNK_SIZE = 16384 // 16KB chunks for better memory usage

function createWindow() {
	mainWindow = new BrowserWindow({
		width: 1200,
		height: 800,
		icon: path.join(__dirname, "assets/icon.ico"),
		webPreferences: {
			nodeIntegration: false,
			contextIsolation: true,
			preload: path.join(__dirname, "preload.js"),
		},
	})

	mainWindow.loadFile("index.html")
}

// Improved file hash calculation using streams with error handling
async function getFileHash(filePath) {
	return new Promise((resolve, reject) => {
		const hash = crypto.createHash("md5")
		const stream = require("fs").createReadStream(filePath, {
			highWaterMark: CHUNK_SIZE,
		})

		let completed = false

		stream.on("data", (data) => {
			hash.update(data)
		})

		stream.on("end", () => {
			completed = true
			resolve(hash.digest("hex"))
		})

		stream.on("error", (error) => {
			if (!completed) {
				reject(error)
			}
		})

		// Add timeout to prevent hanging
		setTimeout(() => {
			if (!completed) {
				stream.destroy()
				reject(new Error("Hash calculation timed out"))
			}
		}, 30000) // 30 second timeout
	})
}

// Check if path should be ignored
function shouldIgnore(pathToCheck) {
	return IGNORE_PATTERNS.some((pattern) => pattern.test(pathToCheck))
}

// Count total files for progress tracking
async function countFiles(dirPath) {
	let count = 0
	const errors = []

	async function count_recursive(currentPath) {
		try {
			const entries = await fs.readdir(currentPath, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(currentPath, entry.name)

				if (shouldIgnore(fullPath)) continue

				try {
					if (entry.isDirectory()) {
						await count_recursive(fullPath)
					} else if (entry.isFile()) {
						const stats = await fs.stat(fullPath)
						if (stats.size > 0 && stats.size <= 1024 * 1024 * 500) {
							count++
						}
					}
				} catch (error) {
					errors.push({ path: fullPath, error: error.message })
				}
			}
		} catch (error) {
			errors.push({ path: currentPath, error: error.message })
		}
	}

	await count_recursive(dirPath)
	return { count, errors }
}

// Scan directory with progress reporting and error handling
async function scanDirectory(dirPath, progressCallback) {
	const fileInfos = []
	const errors = []

	async function scan(currentPath) {
		try {
			const entries = await fs.readdir(currentPath, { withFileTypes: true })

			for (const entry of entries) {
				const fullPath = path.join(currentPath, entry.name)

				if (shouldIgnore(fullPath)) continue

				try {
					if (entry.isDirectory()) {
						await scan(fullPath)
					} else if (entry.isFile()) {
						const stats = await fs.stat(fullPath)

						// Skip empty files and very large files
						if (stats.size === 0 || stats.size > 1024 * 1024 * 500) continue

						try {
							const hash = await getFileHash(fullPath)
							fileInfos.push({
								path: fullPath,
								size: stats.size,
								modified: stats.mtime,
								hash: hash,
							})

							if (progressCallback) {
								progressCallback({
									filesScanned: fileInfos.length,
									currentFile: fullPath,
								})
							}
						} catch (hashError) {
							errors.push({
								path: fullPath,
								error: `Hash calculation failed: ${hashError.message}`,
							})
						}
					}
				} catch (error) {
					errors.push({ path: fullPath, error: error.message })
					continue
				}
			}
		} catch (error) {
			errors.push({ path: currentPath, error: error.message })
		}
	}

	await scan(dirPath)
	return { fileInfos, errors }
}

// Find duplicates with size-based optimization
function findDuplicates(files) {
	// First group by size
	const sizeGroups = new Map()
	files.forEach((file) => {
		const size = file.size
		if (!sizeGroups.has(size)) {
			sizeGroups.set(size, [])
		}
		sizeGroups.get(size).push(file)
	})

	// Then find duplicates within same-size groups using hash
	const duplicates = new Map()
	for (const sizeGroup of sizeGroups.values()) {
		if (sizeGroup.length > 1) {
			// Only check groups with potential duplicates
			for (const file of sizeGroup) {
				const hash = file.hash
				if (!duplicates.has(hash)) {
					duplicates.set(hash, [])
				}
				duplicates.get(hash).push(file)
			}
		}
	}

	// Filter out non-duplicates and sort by size (largest first)
	const filteredDuplicates = new Map(
		[...duplicates.entries()]
			.filter(([_, files]) => files.length > 1)
			.sort((a, b) => b[1][0].size - a[1][0].size)
	)

	return filteredDuplicates
}

// IPC Handlers
ipcMain.handle("preview-file", async (_, filePath) => {
	try {
		await shell.openPath(filePath)
		return true
	} catch (error) {
		console.error("Error opening file:", error)
		throw error
	}
})

ipcMain.handle("select-directory", async (event) => {
	try {
		const result = await dialog.showOpenDialog(mainWindow, {
			properties: ["openDirectory"],
		})

		if (!result.canceled) {
			const dirPath = result.filePaths[0]
			console.log("Scanning directory:", dirPath)

			// First count total files
			const { count: totalFiles } = await countFiles(dirPath)
			event.sender.send("scan-started", { totalFiles })

			// Report progress through a separate channel
			const progressCallback = (progress) => {
				event.sender.send("scan-progress", {
					...progress,
					totalFiles,
				})
			}

			const { fileInfos, errors } = await scanDirectory(
				dirPath,
				progressCallback
			)

			if (errors.length > 0) {
				console.warn("Scanning completed with some errors:", errors)
				event.sender.send("scan-errors", errors)
			}

			event.sender.send("scan-complete")
			console.log(`Found ${fileInfos.length} files`)
			const duplicates = findDuplicates(fileInfos)
			console.log(`Found ${duplicates.size} groups of duplicates`)
			return Array.from(duplicates.entries())
		}
		return []
	} catch (error) {
		console.error("Error in select-directory:", error)
		throw error
	}
})

ipcMain.handle("delete-file", async (_, filePath) => {
	try {
		await fs.unlink(filePath)
		return true
	} catch (error) {
		console.error("Error deleting file:", error)
		throw error
	}
})

ipcMain.handle("restore-file", async (_, filePath) => {
	try {
		// In a real app, you'd need to implement actual file restoration
		// This is just a placeholder
		return true
	} catch (error) {
		console.error("Error restoring file:", error)
		throw error
	}
})

// App initialization
app.whenReady().then(() => {
	createWindow()

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow()
		}
	})
})

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit()
	}
})
