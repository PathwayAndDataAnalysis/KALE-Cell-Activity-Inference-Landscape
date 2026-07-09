const appColorSchemeQuery = window.matchMedia("(prefers-color-scheme: dark)");

window.appTheme = {
	isDark() {
		return appColorSchemeQuery.matches;
	},

	getPlotlyLayout() {
		if (appColorSchemeQuery.matches) {
			return {
				paper_bgcolor: "#111827",
				plot_bgcolor: "#111827",
				font: { color: "#e5e7eb" },
				xaxis: {
					gridcolor: "#374151",
					linecolor: "#4b5563",
					zerolinecolor: "#4b5563",
					tickfont: { color: "#d1d5db" },
				},
				yaxis: {
					gridcolor: "#374151",
					linecolor: "#4b5563",
					zerolinecolor: "#4b5563",
					tickfont: { color: "#d1d5db" },
				},
				legend: {
					bgcolor: "rgba(17, 24, 39, 0.9)",
					bordercolor: "#374151",
					font: { color: "#e5e7eb" },
				},
			};
		}

		return {
			paper_bgcolor: "#ffffff",
			plot_bgcolor: "#ffffff",
			font: { color: "#1f2937" },
			xaxis: {
				gridcolor: "#e5e7eb",
				linecolor: "#d1d5db",
				zerolinecolor: "#d1d5db",
				tickfont: { color: "#4b5563" },
			},
			yaxis: {
				gridcolor: "#e5e7eb",
				linecolor: "#d1d5db",
				zerolinecolor: "#d1d5db",
				tickfont: { color: "#4b5563" },
			},
			legend: {
				bgcolor: "rgba(255, 255, 255, 0.9)",
				bordercolor: "#e5e7eb",
				font: { color: "#1f2937" },
			},
		};
	},

	getPlotlyRelayout() {
		const layout = this.getPlotlyLayout();

		return {
			paper_bgcolor: layout.paper_bgcolor,
			plot_bgcolor: layout.plot_bgcolor,
			"font.color": layout.font.color,
			"xaxis.gridcolor": layout.xaxis.gridcolor,
			"xaxis.linecolor": layout.xaxis.linecolor,
			"xaxis.zerolinecolor": layout.xaxis.zerolinecolor,
			"xaxis.tickfont.color": layout.xaxis.tickfont.color,
			"yaxis.gridcolor": layout.yaxis.gridcolor,
			"yaxis.linecolor": layout.yaxis.linecolor,
			"yaxis.zerolinecolor": layout.yaxis.zerolinecolor,
			"yaxis.tickfont.color": layout.yaxis.tickfont.color,
			"legend.bgcolor": layout.legend.bgcolor,
			"legend.bordercolor": layout.legend.bordercolor,
			"legend.font.color": layout.legend.font.color,
		};
	},

	onChange(callback) {
		if (typeof callback !== "function") return () => {};

		const handler = () => callback(appColorSchemeQuery.matches);
		if (appColorSchemeQuery.addEventListener) {
			appColorSchemeQuery.addEventListener("change", handler);
			return () => appColorSchemeQuery.removeEventListener("change", handler);
		}

		appColorSchemeQuery.addListener(handler);
		return () => appColorSchemeQuery.removeListener(handler);
	},
};

const FLASH_FADE_DELAY = 3000;
const FLASH_REMOVE_DELAY_AFTER_FADE = 500;

function scheduleFlashRemoval(message, delay = FLASH_FADE_DELAY) {
	setTimeout(function () {
		message.classList.add("fade-out");
		setTimeout(function () {
			if (message.parentNode) {
				message.remove();
			}
		}, FLASH_REMOVE_DELAY_AFTER_FADE);
	}, delay);
}

function getFlashClasses(category) {
	if (category === "error") return "bg-red-600 text-white";
	if (category === "success") return "bg-green-600 text-white";
	return "bg-blue-600 text-white";
}

function getFlashIcon(category) {
	if (category === "success") {
		return `
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
			</svg>
		`;
	}
	if (category === "error") {
		return `
			<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
				<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
			</svg>
		`;
	}
	return `
		<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
			<path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path>
		</svg>
	`;
}

window.showFlashMessage = function (message, category = "info") {
	const container = document.getElementById("flash-message-container");
	if (!container) return;

	const normalizedCategory = ["error", "success"].includes(category) ? category : "info";
	const flashMessage = document.createElement("div");
	flashMessage.className = `flash-message-item rounded-md p-4 shadow-lg text-sm font-medium ${getFlashClasses(normalizedCategory)}`;
	flashMessage.setAttribute("role", "alert");

	const row = document.createElement("div");
	row.className = "flex items-center";
	row.innerHTML = getFlashIcon(normalizedCategory);

	const text = document.createElement("span");
	text.textContent = message;
	row.appendChild(text);
	flashMessage.appendChild(row);
	container.appendChild(flashMessage);
	scheduleFlashRemoval(flashMessage);
};

document.addEventListener("DOMContentLoaded", function () {
	const flashMessages = document.querySelectorAll("#flash-message-container .flash-message-item");

	flashMessages.forEach(function (message, index) {
		scheduleFlashRemoval(message, FLASH_FADE_DELAY + index * 300);
	});

	try {
		const pendingFlashMessage = window.sessionStorage.getItem("pendingFlashMessage");
		if (pendingFlashMessage) {
			window.sessionStorage.removeItem("pendingFlashMessage");
			const parsedMessage = JSON.parse(pendingFlashMessage);
			if (parsedMessage && parsedMessage.message) {
				window.showFlashMessage(parsedMessage.message, parsedMessage.category || "info");
			}
		}
	} catch (error) {
		// Session storage may be unavailable in some browser privacy modes.
	}
});

function addInputValidation(inputId, min, max = null) {
	const input = document.getElementById(inputId);
	if (!input) return;
	input.addEventListener("input", function () {
		if (this.value === "") return;

		let value = Number(this.value);

		if (isNaN(value)) {
			this.value = "";
			return;
		}
		if (value < min) this.value = min;
		if (max !== null && value > max) {
			this.value = max;
		}
	});
}
