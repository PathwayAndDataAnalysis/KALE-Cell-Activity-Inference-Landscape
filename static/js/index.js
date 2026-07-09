document.addEventListener("DOMContentLoaded", function () {
	const dataFileInput = document.getElementById("data_file");
	const fileTypeSelect = document.getElementById("file_type");
	const descriptionInput = document.getElementById("description");
	const fileTypeContainer = document.getElementById("file-type-container");
	const uploadModal = document.getElementById("upload-modal");
	const uploadForm = document.getElementById("upload-form");
	const openUploadModalBtn = document.getElementById("open-upload-modal-btn");
	const closeUploadModalBtn = document.getElementById("close-upload-modal-btn");
	const cancelUploadBtn = document.getElementById("cancel-upload-btn");
	const uploadSubmitBtn = document.getElementById("upload-submit-btn");
	const uploadProgressPanel = document.getElementById("upload-progress-panel");
	const uploadProgressLabel = document.getElementById("upload-progress-label");
	const uploadProgressPercent = document.getElementById("upload-progress-percent");
	const uploadProgressBar = document.getElementById("upload-progress-bar");
	const uploadProgressDetail = document.getElementById("upload-progress-detail");
	const seeMoreButtons = document.querySelectorAll(".see-more-btn");
	const searchInput = document.getElementById("analysis-search-input");
	const cardsContainer = document.getElementById("analysis-cards-container");
	let activeUploadRequest = null;
	let uploadInProgress = false;

	const formatBytes = (bytes) => {
		if (!Number.isFinite(bytes)) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
		return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
	};

	const showUploadMessage = (message, category = "info") => {
		if (window.showFlashMessage) {
			window.showFlashMessage(message, category);
		} else {
			alert(message);
		}
	};

	const parseUploadResponse = (request) => {
		try {
			return JSON.parse(request.responseText);
		} catch (error) {
			return null;
		}
	};

	const setUploadProgress = ({ percent = 0, label = "Uploading file", detail = "" } = {}) => {
		if (!uploadProgressPanel || !uploadProgressBar || !uploadProgressPercent || !uploadProgressLabel) {
			return;
		}

		const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
		uploadProgressPanel.classList.remove("hidden");
		uploadProgressLabel.textContent = label;
		uploadProgressPercent.textContent = `${boundedPercent}%`;
		uploadProgressBar.style.width = `${boundedPercent}%`;
		uploadProgressBar.setAttribute("aria-valuenow", String(boundedPercent));

		if (uploadProgressDetail) {
			uploadProgressDetail.textContent = detail;
		}
	};

	const resetUploadProgress = () => {
		if (uploadProgressPanel) {
			uploadProgressPanel.classList.add("hidden");
		}
		if (uploadProgressBar) {
			uploadProgressBar.style.width = "0%";
			uploadProgressBar.setAttribute("aria-valuenow", "0");
		}
		if (uploadProgressPercent) {
			uploadProgressPercent.textContent = "0%";
		}
		if (uploadProgressLabel) {
			uploadProgressLabel.textContent = "Uploading file";
		}
		if (uploadProgressDetail) {
			uploadProgressDetail.textContent = "Preparing upload...";
		}
	};

	const setUploadControlsEnabled = (enabled) => {
		if (dataFileInput) dataFileInput.disabled = !enabled;
		if (fileTypeSelect) fileTypeSelect.disabled = !enabled;
		if (descriptionInput) descriptionInput.disabled = !enabled;
		if (uploadSubmitBtn) {
			uploadSubmitBtn.disabled = !enabled;
			uploadSubmitBtn.value = enabled ? "Upload Data" : "Uploading...";
		}
		if (closeUploadModalBtn) {
			closeUploadModalBtn.disabled = !enabled;
			closeUploadModalBtn.classList.toggle("opacity-50", !enabled);
			closeUploadModalBtn.classList.toggle("cursor-not-allowed", !enabled);
		}
		if (cancelUploadBtn) {
			cancelUploadBtn.textContent = enabled ? "Cancel" : "Cancel upload";
		}
	};

	const finishUpload = () => {
		activeUploadRequest = null;
		uploadInProgress = false;
		setUploadControlsEnabled(true);
	};

	if (dataFileInput && fileTypeContainer) {
		dataFileInput.addEventListener("change", () => {
			const file = dataFileInput.files[0];
			resetUploadProgress();
			if (!file) {
				fileTypeContainer.classList.add("hidden");
				return;
			}

			const filename = file.name.toLowerCase();
			// Show the checkbox for tsv or csv files
			if (filename.endsWith(".tsv") || filename.endsWith(".csv")) {
				fileTypeContainer.classList.remove("hidden");
			} else {
				fileTypeContainer.classList.add("hidden");
			}
		});
	}

	// Check if we are on a page that has the modal elements
	if (!uploadModal || !openUploadModalBtn || !closeUploadModalBtn || !cancelUploadBtn || !uploadForm) {
		return; // Exit if modal elements aren't found
	}

	const openModal = () => {
		uploadModal.classList.remove("hidden");
		uploadModal.classList.add("flex"); // Use flex to enable centering
	};

	const closeModal = () => {
		if (uploadInProgress) return;
		uploadModal.classList.add("hidden");
		uploadModal.classList.remove("flex");
		resetUploadProgress();
	};

	openUploadModalBtn.addEventListener("click", openModal);
	closeUploadModalBtn.addEventListener("click", closeModal);
	cancelUploadBtn.addEventListener("click", () => {
		if (uploadInProgress && activeUploadRequest) {
			activeUploadRequest.abort();
			return;
		}
		closeModal();
	});

	// Close the modal if the user clicks on the dark background
	uploadModal.addEventListener("click", (event) => {
		if (event.target === uploadModal) {
			closeModal();
		}
	});

	// Close the modal if the user presses the 'Escape' key
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && !uploadModal.classList.contains("hidden")) {
			closeModal();
		}
	});

	uploadForm.addEventListener("submit", (event) => {
		event.preventDefault();
		if (uploadInProgress) return;
		if (!uploadForm.reportValidity()) return;

		const selectedFile = dataFileInput && dataFileInput.files ? dataFileInput.files[0] : null;
		const formData = new FormData(uploadForm);
		const request = new XMLHttpRequest();

		activeUploadRequest = request;
		uploadInProgress = true;
		setUploadControlsEnabled(false);
		setUploadProgress({
			percent: 0,
			label: "Uploading file",
			detail: selectedFile ? `Preparing ${selectedFile.name} (${formatBytes(selectedFile.size)})...` : "Preparing upload...",
		});

		request.open("POST", uploadForm.action);
		request.setRequestHeader("X-Requested-With", "XMLHttpRequest");
		request.setRequestHeader("Accept", "application/json");

		request.upload.addEventListener("progress", (progressEvent) => {
			if (!progressEvent.lengthComputable) {
				setUploadProgress({
					percent: 0,
					label: "Uploading file",
					detail: "Uploading file to the server...",
				});
				return;
			}

			const percent = (progressEvent.loaded / progressEvent.total) * 100;
			setUploadProgress({
				percent,
				label: percent >= 100 ? "Finalizing upload" : "Uploading file",
				detail: `${formatBytes(progressEvent.loaded)} of ${formatBytes(progressEvent.total)} uploaded`,
			});
		});

		request.upload.addEventListener("load", () => {
			setUploadProgress({
				percent: 100,
				label: "Finalizing upload",
				detail: "The file reached the server. Saving and validating it now...",
			});
		});

		request.addEventListener("load", () => {
			const response = parseUploadResponse(request);
			const message =
				(response && (response.message || response.error)) ||
				(request.status >= 200 && request.status < 300
					? "File uploaded successfully."
					: "Upload failed. Please try again.");
			const category = (response && response.category) || (request.status >= 200 && request.status < 300 ? "success" : "error");

			if (request.status >= 200 && request.status < 300 && (!response || response.success !== false)) {
				setUploadProgress({
					percent: 100,
					label: "Upload complete",
					detail: "Refreshing your file list...",
				});

				try {
					window.sessionStorage.setItem("pendingFlashMessage", JSON.stringify({ message, category }));
				} catch (error) {
					showUploadMessage(message, category);
				}

				setTimeout(() => {
					if (response && response.redirect_url) {
						window.location.href = response.redirect_url;
					} else {
						window.location.reload();
					}
				}, 900);
				return;
			}

			finishUpload();
			resetUploadProgress();
			showUploadMessage(message, category);
		});

		request.addEventListener("error", () => {
			finishUpload();
			resetUploadProgress();
			showUploadMessage("Upload failed. Please check your connection and try again.", "error");
		});

		request.addEventListener("abort", () => {
			finishUpload();
			resetUploadProgress();
			showUploadMessage("Upload canceled.", "info");
		});

		request.send(formData);
	});

	seeMoreButtons.forEach((button) => {
		button.addEventListener("click", (event) => {
			const parentDiv = event.target.closest("div");
			const shortSpan = parentDiv.querySelector(".description-short");
			const fullSpan = parentDiv.querySelector(".description-full");

			// Toggle visibility
			shortSpan.classList.toggle("hidden");
			fullSpan.classList.toggle("hidden");

			// Change button text
			if (fullSpan.classList.contains("hidden")) {
				event.target.textContent = "See more";
			} else {
				event.target.textContent = "See less";
			}
		});
	});

	if (searchInput && cardsContainer) {
		searchInput.addEventListener("input", (event) => {
			const searchTerm = event.target.value.toLowerCase();
			const cards = cardsContainer.querySelectorAll(".analysis-card");

			cards.forEach((card) => {
				const cardText = card.textContent.toLowerCase();
				if (cardText.includes(searchTerm)) {
					card.style.display = "flex"; // Use 'flex' since our card uses it
				} else {
					card.style.display = "none";
				}
			});
		});
	}
});
