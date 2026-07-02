const layoutCheckbox = document.getElementById("have_2d_layout");
const layoutSelectionSection = document.getElementById("2d_layout_selection_section");
const umapParamsSection = document.getElementById("umap_parameters_section");
const layoutFile2D = document.getElementById("layout_file_2d");
const h5adCheckbox = document.getElementById("have_h5ad");
const h5adSelectionSection = document.getElementById("h5ad_selection_section");
const h5adFileSelection = document.getElementById("selected_h5ad_file");
const separateFilesSection = document.getElementById("separate_files_section");
const geneExpFile = document.getElementById("gene_exp_file");
const speciesSelection = document.getElementById("species");
const metadataFile = document.getElementById("metadata_file");

const qcPlotGeneExpressionStats = document.getElementById("qc-plot-gene-expression-stats");
const qcPlotGenesPerCellStats = document.getElementById("qc-plot-genes-per-cell-stats");
const qcPlotCellsPerGeneStats = document.getElementById("qc-plot-cells-per-gene-stats");
const qcPlotMTPercentStats = document.getElementById("qc-plot-mt-percent-stats");
const qcModal = document.getElementById("qc-modal");
const qcSelectedFileName = document.getElementById("qc-selected-file-name");
const openQcButtons = document.querySelectorAll("[data-open-qc-modal]");
const closeQcButtons = document.querySelectorAll("[data-close-qc-modal]");
const qcUnavailableMessages = document.querySelectorAll("[data-qc-unavailable]");

function getPlotThemeLayout() {
	return window.appTheme ? window.appTheme.getPlotlyLayout() : {};
}

function getPlotThemeRelayout() {
	return window.appTheme ? window.appTheme.getPlotlyRelayout() : {};
}

function withPlotTheme(layout) {
	const theme = getPlotThemeLayout();

	return {
		...layout,
		paper_bgcolor: theme.paper_bgcolor,
		plot_bgcolor: theme.plot_bgcolor,
		font: { ...(layout.font || {}), ...(theme.font || {}) },
		xaxis: { ...(layout.xaxis || {}), ...(theme.xaxis || {}) },
		yaxis: { ...(layout.yaxis || {}), ...(theme.yaxis || {}) },
		legend: { ...(theme.legend || {}), ...(layout.legend || {}) },
	};
}

function getActiveQcSource() {
	return h5adCheckbox && h5adCheckbox.checked ? "h5ad" : "gene";
}

function getSelectedQcFilename(source = getActiveQcSource()) {
	const selectedValue = source === "h5ad" ? h5adFileSelection?.value : geneExpFile?.value;
	if (!selectedValue || selectedValue.startsWith("select-")) return null;
	return selectedValue;
}

function getSelectedQcFile(source = getActiveQcSource()) {
	const selectedFilename = getSelectedQcFilename(source);
	if (!selectedFilename) return null;
	return (window.user_files || []).find((file) => file.filename === selectedFilename) || null;
}

function hasMetricCounts(metric) {
	return metric && Array.isArray(metric.counts) && metric.counts.length > 0;
}

function hasQcMetrics(file) {
	if (!file || !file.qc_metrics || typeof file.qc_metrics !== "object") return false;

	return [
		file.qc_metrics.gene_expression,
		file.qc_metrics.n_genes_by_counts,
		file.qc_metrics.n_cells_by_counts,
		file.qc_metrics.pct_counts_mt,
	].some(hasMetricCounts);
}

function getFileDisplayName(file) {
	return file?.original_filename || file?.filename || "Selected file";
}

function updateQcControls() {
	const activeSource = getActiveQcSource();

	openQcButtons.forEach((button) => {
		const source = button.dataset.qcSource;
		const shouldShow = source === activeSource && hasQcMetrics(getSelectedQcFile(source));
		button.classList.toggle("hidden", !shouldShow);
		button.disabled = !shouldShow;
	});

	qcUnavailableMessages.forEach((message) => {
		const source = message.dataset.qcUnavailable;
		const selectedFile = getSelectedQcFile(source);
		const shouldShow = source === activeSource && selectedFile && !hasQcMetrics(selectedFile);
		message.classList.toggle("hidden", !shouldShow);
	});
}

function toggleH5adSection() {
	if (h5adCheckbox.checked) {
		if (h5adSelectionSection) h5adSelectionSection.style.display = "block";
		if (separateFilesSection) separateFilesSection.style.display = "none";
		if (geneExpFile) geneExpFile.required = false;
		if (metadataFile) metadataFile.required = false;

		if (geneExpFile) geneExpFile.value = "select-gene-exp-file";
		if (speciesSelection) speciesSelection.value = "select-species";
		if (metadataFile) metadataFile.value = "select-metadata-file";
	} else {
		if (h5adSelectionSection) h5adSelectionSection.style.display = "none";
		if (separateFilesSection) separateFilesSection.style.display = "block";
		if (geneExpFile) geneExpFile.required = true;
		if (metadataFile) metadataFile.required = false;

		if (h5adFileSelection) h5adFileSelection.value = "select-h5ad-file";
	}
	updateQcControls();
}

function toggleLayoutSection() {
	if (layoutCheckbox.checked) {
		layoutSelectionSection.style.display = "block";
		umapParamsSection.style.display = "none";
		layoutFile2D.required = true;
	} else {
		layoutSelectionSection.style.display = "none";
		umapParamsSection.style.display = "block";
		layoutFile2D.required = false;
		layoutFile2D.value = "";
	}
}

function getPlotPalette() {
	const isDark = window.appTheme ? window.appTheme.isDark() : false;

	return {
		bar: isDark ? "#60a5fa" : "#2563eb",
		barLine: isDark ? "#93c5fd" : "#1d4ed8",
		hoverBg: isDark ? "#1f2937" : "#ffffff",
	};
}

function formatMetricValue(value) {
	const numericValue = Number(value);
	if (!Number.isFinite(numericValue)) return value ?? "N/A";

	return numericValue.toLocaleString(undefined, {
		maximumFractionDigits: Math.abs(numericValue) >= 100 ? 0 : 2,
	});
}

function renderStats(statsElement, metrics) {
	statsElement.innerHTML = `<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		${metrics
			.map(
				(metric) => `<div class="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
					<p class="text-[0.65rem] font-semibold uppercase tracking-wide text-gray-500">${metric.label}</p>
					<p class="mt-1 truncate font-mono text-sm font-semibold text-gray-900">${formatMetricValue(metric.value)}</p>
				</div>`,
			)
			.join("")}
	</div>`;
}

function renderEmptyPlot(divElement, statsElement, title) {
	if (divElement.data) Plotly.purge(divElement);
	divElement.innerHTML = `<div class="flex h-full items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">No QC data available for ${title}.</div>`;
	statsElement.innerHTML = "";
}

function renderHistogram(divElement, statsElement, data, title, xtitle, ytitle) {
	if (!data || !data.bins || !data.counts) {
		renderEmptyPlot(divElement, statsElement, title);
		return;
	}

	divElement.classList.remove("hidden");
	// Plotly expects bin centers, not edges, for bar charts representing histograms
	const binCenters = data.bins.slice(0, -1).map((b, i) => (b + data.bins[i + 1]) / 2);
	const palette = getPlotPalette();

	const plotData = [
		{
			x: binCenters,
			y: data.counts,
			type: "bar",
			marker: {
				color: palette.bar,
				line: { color: palette.barLine, width: 0.5 },
				opacity: 0.92,
			},
			hovertemplate: `${xtitle}: %{x}<br>${ytitle}: %{y}<extra></extra>`,
		},
	];

	const layout = withPlotTheme({
		xaxis: { title: { text: xtitle, font: { size: 12 } }, automargin: true, tickformat: "~s" },
		yaxis: { title: { text: ytitle, font: { size: 12 } }, automargin: true, tickformat: "~s" },
		margin: { t: 12, b: 52, l: 62, r: 20 },
		bargap: 0.03,
		dragmode: "pan",
		hovermode: "closest",
		hoverlabel: {
			bgcolor: palette.hoverBg,
			bordercolor: palette.barLine,
			font: { size: 12 },
		},
	});

	Plotly.newPlot(divElement, plotData, layout, {
		responsive: true,
		displayModeBar: false,
		displaylogo: false,
		scrollZoom: true,
	});

	renderStats(statsElement, [
		{ label: "Min", value: data.min },
		{ label: "Mean", value: data.mean },
		{ label: "Std. Dev.", value: data.sd },
		{ label: "Max", value: data.max },
	]);
}

document.addEventListener("DOMContentLoaded", function () {
	toggleH5adSection();
	toggleLayoutSection();

	const plotConfigs = [
		{
			key: "gene_expression",
			card: document.getElementById("qc-card-gene-expression"),
			div: document.getElementById("qc-plot-gene-expression"),
			stats: qcPlotGeneExpressionStats,
			title: "Gene Expression",
			xtitle: "Expression Level",
			ytitle: "Cell Count",
		},
		{
			key: "n_genes_by_counts",
			card: document.getElementById("qc-card-genes-per-cell"),
			div: document.getElementById("qc-plot-genes-per-cell"),
			stats: qcPlotGenesPerCellStats,
			title: "Genes per Cell",
			xtitle: "Number of Genes",
			ytitle: "Cell Count",
		},
		{
			key: "n_cells_by_counts",
			card: document.getElementById("qc-card-cells-per-gene"),
			div: document.getElementById("qc-plot-cells-per-gene"),
			stats: qcPlotCellsPerGeneStats,
			title: "Cells per Gene",
			xtitle: "Number of Cells",
			ytitle: "Gene Count",
		},
		{
			key: "pct_counts_mt",
			card: document.getElementById("qc-card-mt-percent"),
			div: document.getElementById("qc-plot-mt-percent"),
			stats: qcPlotMTPercentStats,
			title: "Mitochondrial Content %",
			xtitle: "% MT",
			ytitle: "Cell Count",
		},
	];

	function resizeQcPlots() {
		plotConfigs.forEach(({ div }) => {
			if (div && div.data) Plotly.Plots.resize(div);
		});
	}

	function refreshQcPlotThemes() {
		const palette = getPlotPalette();

		plotConfigs.forEach(({ div }) => {
			if (!div || !div.data) return;
			Plotly.restyle(
				div,
				{
					"marker.color": palette.bar,
					"marker.line.color": palette.barLine,
				},
				[0],
			);
			Plotly.relayout(div, getPlotThemeRelayout());
		});
	}

	if (window.appTheme) window.appTheme.onChange(refreshQcPlotThemes);

	function renderQcPlotsForFile(file) {
		if (!hasQcMetrics(file)) return false;
		const qcMetrics = file.qc_metrics;

		plotConfigs.forEach((config) => {
			if (config.card) config.card.classList.remove("hidden");
			const metric = qcMetrics[config.key];
			renderHistogram(config.div, config.stats, metric, config.title, config.xtitle, config.ytitle);
		});

		return true;
	}

	function openQcModal() {
		const selectedFile = getSelectedQcFile();
		if (!hasQcMetrics(selectedFile)) {
			updateQcControls();
			return;
		}

		if (qcSelectedFileName) qcSelectedFileName.textContent = getFileDisplayName(selectedFile);
		qcModal.classList.remove("hidden");
		qcModal.classList.add("flex");
		document.body.classList.add("overflow-hidden");
		renderQcPlotsForFile(selectedFile);
		requestAnimationFrame(resizeQcPlots);
	}

	function closeQcModal() {
		qcModal.classList.add("hidden");
		qcModal.classList.remove("flex");
		document.body.classList.remove("overflow-hidden");
	}

	if (geneExpFile)
		geneExpFile.addEventListener("change", function () {
			updateQcControls();
		});

	if (h5adFileSelection)
		h5adFileSelection.addEventListener("change", function () {
			updateQcControls();
		});

	openQcButtons.forEach((button) => {
		button.addEventListener("click", openQcModal);
	});

	closeQcButtons.forEach((button) => {
		button.addEventListener("click", closeQcModal);
	});

	if (qcModal) {
		qcModal.addEventListener("click", (event) => {
			if (event.target === qcModal) closeQcModal();
		});
	}

	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && qcModal && !qcModal.classList.contains("hidden")) {
			closeQcModal();
		}
	});

	updateQcControls();

	// Validation for input fields
	addInputValidation("min-genes", 0);
	addInputValidation("min-cells", 0);
	addInputValidation("data-normalize-value", 0);
	addInputValidation("max-mt-pct", 0, 100);
	addInputValidation("pca_components", 2);
	addInputValidation("n_neighbors", 2);
	addInputValidation("min_dist", 0.0, 1.0);
	addInputValidation("random-state", 0);
	addInputValidation("fdr_level", 0.0, 1.0);

	// Reusable tooltip logic for all info buttons
	const infoButtons = document.querySelectorAll(".info-btn");
	let openTooltip = null;

	infoButtons.forEach((btn) => {
		btn.addEventListener("click", function (e) {
			e.stopPropagation();
			// Hide any open tooltip
			if (openTooltip) openTooltip.classList.add("hidden");
			// Show the clicked tooltip
			const tooltipId = btn.getAttribute("data-tooltip-id");
			const tooltip = document.getElementById(tooltipId);
			if (tooltip) {
				tooltip.classList.toggle("hidden");
				// Position tooltip below the button
				const rect = btn.getBoundingClientRect();
				tooltip.style.top = rect.bottom + window.scrollY + 5 + "px";
				tooltip.style.left = rect.left + window.scrollX + "px";
				openTooltip = tooltip;
			}
		});
	});

	// Hide tooltip when clicking outside
	document.addEventListener("click", function () {
		if (openTooltip) openTooltip.classList.add("hidden");
		openTooltip = null;
	});

	// Prevent closing when clicking inside tooltip
	document.querySelectorAll(".z-10").forEach((tooltip) => {
		tooltip.addEventListener("click", function (e) {
			e.stopPropagation();
		});
	});
});
