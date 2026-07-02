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

document.addEventListener("DOMContentLoaded", function () {
	const flashMessages = document.querySelectorAll("#flash-message-container .flash-message-item");
	const FADE_DELAY = 3000; // 3 seconds
	const REMOVE_DELAY_AFTER_FADE = 500;

	flashMessages.forEach(function (message, index) {
		setTimeout(
			function () {
				message.classList.add("fade-out");
				setTimeout(function () {
					if (message.parentNode) {
						message.remove();
					}
				}, REMOVE_DELAY_AFTER_FADE);
			},
			FADE_DELAY + index * 300,
		);
	});
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
