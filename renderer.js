// renderer.js
// Fix progress tracking and UI updates
const appState = {
	scanning: false,
	filesScanned: 0,
	totalFiles: 0,
	selectedFiles: new Set(),
	deletedFiles: [],
	currentFilters: {
		images: true,
		documents: true,
		videos: true,
		others: true,
	},
	sortBy: "size",
	currentFile: "",
	errors: [],
}

// Add missing event listeners for scan progress
window.electron.receive("scan-started", ({ totalFiles }) => {
	appState.scanning = true
	appState.totalFiles = totalFiles
	appState.filesScanned = 0

	const progressContainer = document.getElementById("progressContainer")
	const totalFilesElement = document.getElementById("totalFiles")
	const filesScannedElement = document.getElementById("filesScanned")
	const progressBarInner = document.getElementById("progressBarInner")
	const status = document.getElementById("status")

	progressContainer.style.display = "block"
	totalFilesElement.textContent = totalFiles
	filesScannedElement.textContent = "0"
	progressBarInner.style.width = "0%"
	status.textContent = "Scanning..."
})

window.electron.receive(
	"scan-progress",
	({ filesScanned, currentFile, totalFiles }) => {
		appState.filesScanned = filesScanned
		appState.currentFile = currentFile

		const progressPercent = ((filesScanned / totalFiles) * 100).toFixed(1)
		document.getElementById("filesScanned").textContent = filesScanned
		document.getElementById("currentFile").textContent = currentFile
		document.getElementById("progressBarInner").style.width =
			`${progressPercent}%`
	}
)

window.electron.receive("scan-complete", () => {
	appState.scanning = false
	const status = document.getElementById("status")
	const progressContainer = document.getElementById("progressContainer")

	status.textContent = "Scan complete!"
	setTimeout(() => {
		progressContainer.style.display = "none"
	}, 2000)
})

// Fix search functionality
document.getElementById("searchInput").addEventListener("input", (e) => {
	const searchTerm = e.target.value.toLowerCase()
	const duplicateGroups = document.querySelectorAll(".duplicate-group")

	duplicateGroups.forEach((group) => {
		const filePaths = Array.from(group.querySelectorAll(".file-path")).map(
			(el) => el.textContent.toLowerCase()
		)

		const matches = filePaths.some((path) => path.includes(searchTerm))
		group.style.display = matches ? "block" : "none"
	})
})

// Fix filter functionality
function filterResults() {
	const showImages = document.getElementById("showImages").checked
	const showDocuments = document.getElementById("showDocuments").checked
	const showVideos = document.getElementById("showVideos").checked
	const showOthers = document.getElementById("showOthers").checked
	const sortBy = document.getElementById("sortBy").value
	const searchTerm = document.getElementById("searchInput").value.toLowerCase()

	const duplicateGroups = Array.from(
		document.querySelectorAll(".duplicate-group")
	)

	duplicateGroups.forEach((group) => {
		const firstFilePath = group.querySelector(".file-path").textContent
		const fileType = getFileType(firstFilePath)

		let shouldShow = false
		switch (fileType) {
			case "image":
				shouldShow = showImages
				break
			case "document":
				shouldShow = showDocuments
				break
			case "video":
				shouldShow = showVideos
				break
			default:
				shouldShow = showOthers
		}

		// Apply search filter
		if (shouldShow && searchTerm) {
			shouldShow = firstFilePath.toLowerCase().includes(searchTerm)
		}

		group.style.display = shouldShow ? "block" : "none"
	})

	// Apply sorting to visible groups
	sortDuplicateGroups(sortBy)
}

// Fix sorting functionality
function sortDuplicateGroups(sortBy) {
	const resultsDiv = document.getElementById("results")
	const groups = Array.from(document.querySelectorAll(".duplicate-group"))

	groups.sort((a, b) => {
		if (a.style.display === "none" || b.style.display === "none") return 0

		switch (sortBy) {
			case "size": {
				const sizeA = parseFloat(
					a.querySelector("h3").textContent.match(/\((.*?)\)/)[1]
				)
				const sizeB = parseFloat(
					b.querySelector("h3").textContent.match(/\((.*?)\)/)[1]
				)
				return sizeB - sizeA
			}
			case "date": {
				const dateA = new Date(
					a
						.querySelector(".file-info div:nth-child(2)")
						.textContent.split(": ")[1]
				)
				const dateB = new Date(
					b
						.querySelector(".file-info div:nth-child(2)")
						.textContent.split(": ")[1]
				)
				return dateB - dateA
			}
			case "name": {
				const nameA = a.querySelector(".file-path").textContent.toLowerCase()
				const nameB = b.querySelector(".file-path").textContent.toLowerCase()
				return nameA.localeCompare(nameB)
			}
			default:
				return 0
		}
	})

	groups.forEach((group) => resultsDiv.appendChild(group))
}

// Fix undo functionality
async function undoLastDelete() {
	const lastDeleted = appState.deletedFiles.pop()
	if (!lastDeleted) return

	try {
		await window.electron.invoke("restore-file", lastDeleted.path)
		const group = lastDeleted.groupElement
		const filesContainer = group.querySelector(".files-container")

		if (filesContainer) {
			filesContainer.appendChild(lastDeleted.element)
			updateGroupAfterRestore(group)
		} else {
			// Re-create group if it was removed
			document.getElementById("results").appendChild(lastDeleted.groupElement)
		}

		document.getElementById("undoToast").style.display = "none"
	} catch (error) {
		console.error("Error restoring file:", error)
		alert("Error restoring file: " + error.message)
	}
}

// Initialize the application
function init() {
	// Set default filter states
	document.getElementById("showImages").checked = true
	document.getElementById("showDocuments").checked = true
	document.getElementById("showVideos").checked = true
	document.getElementById("showOthers").checked = true

	// Add event listeners
	document
		.getElementById("showImages")
		.addEventListener("change", filterResults)
	document
		.getElementById("showDocuments")
		.addEventListener("change", filterResults)
	document
		.getElementById("showVideos")
		.addEventListener("change", filterResults)
	document
		.getElementById("showOthers")
		.addEventListener("change", filterResults)
	document.getElementById("sortBy").addEventListener("change", filterResults)
	document
		.getElementById("undoButton")
		.addEventListener("click", undoLastDelete)

	// Add transitions
	const style = document.createElement("style")
	style.textContent = `
			.file-item {
					transition: opacity 0.3s ease, transform 0.3s ease;
			}
			.file-item.deleting {
					opacity: 0;
					transform: translateX(-20px);
			}
	`
	document.head.appendChild(style)
}

// Initialize the app
init()
