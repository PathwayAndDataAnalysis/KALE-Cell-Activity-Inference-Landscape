console.log("Analysis object:", window.analysis);

const defaultPointSize = 6;
const defaultOpacity = 0.5;
const hoverPointLimit = 50000;
const wheelZoomSpeed = 0.001;

// Plot configuration panel logic
const plotConfigForm = document.getElementById("plot-config-form");
const plotTitle = document.getElementById("plot-title");
const scatterPlotDiv = document.getElementById("scatterPlot");
const plotTypeSelect = document.getElementById("plot-type");
const colorBySelect = document.getElementById("color-by");
const metadataColSelectionDiv = document.getElementById("metadata-column-selection-div");
const metadataColNameSelect = document.getElementById("metadata-column-name");
const tfSelectionDiv = document.getElementById("tf-selection-div");
const geneEntryDiv = document.getElementById("gene-entry-div");
const colorScaleSelectionDiv = document.getElementById("color-scale-selection-div");
const tfNameSelect = document.getElementById("tf-name-select");
const geneEntryInput = document.getElementById("gene-entry-input");
const pointSizeSlider = document.getElementById("point-size");
const pointSizeValue = document.getElementById("point-size-value");
const opacitySlider = document.getElementById("opacity");
const opacityValue = document.getElementById("opacity-value");
const showLegendCheckbox = document.getElementById("show-legend");
const showGridCheckbox = document.getElementById("show-grid");
const showAxesCheckbox = document.getElementById("show-axes");
const lockAspectCheckbox = document.getElementById("lock-aspect");
const resetPlotStyleBtn = document.getElementById("reset-plot-style");
const downloadPlotPngBtn = document.getElementById("download-plot-png");
const fdrLevel = document.getElementById("fdr-level");
const pValueThreshold = document.getElementById("p-val-threshold");
const applyCorrectionBtn = document.getElementById("apply-correction");
const moreInfoBtn = document.getElementById("more-info-btn");
const modal = document.getElementById("more-info-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const totalCells = document.getElementById("total-cells");
const plotLoadingSpinner = document.getElementById("plot-loading-spinner");
const changeThresholdTypeDiv = document.getElementById("change-threshold-type-div");
const fdrCorrectionRadio = document.getElementById("fdr-correction-radio");
const pValueThresholdRadio = document.getElementById("p-value-threshold-radio");
const plotConfig = {
	responsive: true,
	displayModeBar: true,
	displaylogo: false,
	scrollZoom: false,
};

const defaultBooleanControls = {
	showLegend: true,
	showGrid: true,
	showAxes: true,
	lockAspect: true,
};
const defaultLegendLayout = {
	x: 1,
	y: 1,
	xanchor: "right",
	yanchor: "top",
	orientation: "v",
	traceorder: "normal",
};

function getPlotThemeLayout() {
	return window.appTheme ? window.appTheme.getPlotlyLayout() : {};
}

function getCsrfToken() {
	return document.querySelector('meta[name="csrf-token"]')?.content || "";
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

function refreshScatterPlotTheme() {
	if (!currentRenderedData || !currentRenderedLayout) return;
	renderPlot(currentRenderedData, withPlotTheme(currentRenderedLayout));
}

let plotRevision = 0;
let pendingMarkerStyleFrame = null;
let pendingResizeFrame = null;
let pendingWheelZoomFrame = null;
let pendingWheelRanges = null;
let wheelZoomAttached = false;
let currentHoverDisabledBySize = false;
let currentAxisTitles = { x: "", y: "" };
let currentRenderedData = null;
let currentRenderedLayout = null;

function isPlotReady() {
	return Boolean(scatterPlotDiv && scatterPlotDiv._fullLayout && Array.isArray(scatterPlotDiv.data));
}

function toFloat32Array(values) {
	if (!Array.isArray(values)) return values;

	const typedValues = new Float32Array(values.length);
	for (let i = 0; i < values.length; i += 1) {
		if (values[i] === null || values[i] === undefined) {
			typedValues[i] = Number.NaN;
		} else {
			const value = Number(values[i]);
			typedValues[i] = Number.isFinite(value) ? value : Number.NaN;
		}
	}
	return typedValues;
}

function getCurrentMarkerStyle() {
	return {
		size: pointSizeSlider ? Number(pointSizeSlider.value) : defaultPointSize,
		opacity: opacitySlider ? Number(opacitySlider.value) : defaultOpacity,
	};
}

function getCurrentPlotAppearance() {
	return {
		marker: getCurrentMarkerStyle(),
		showLegend: showLegendCheckbox ? showLegendCheckbox.checked : defaultBooleanControls.showLegend,
		showGrid: showGridCheckbox ? showGridCheckbox.checked : defaultBooleanControls.showGrid,
		showAxes: showAxesCheckbox ? showAxesCheckbox.checked : defaultBooleanControls.showAxes,
		lockAspect: lockAspectCheckbox ? lockAspectCheckbox.checked : defaultBooleanControls.lockAspect,
	};
}

function mergePlotAppearanceIntoLayout(layout, appearance = getCurrentPlotAppearance()) {
	const showAxes = appearance.showAxes;
	const showGrid = appearance.showGrid;

	return {
		...layout,
		dragmode: "pan",
		hovermode: currentHoverDisabledBySize ? false : "closest",
		showlegend: appearance.showLegend,
		legend: { ...(layout.legend || {}), ...defaultLegendLayout },
		xaxis: {
			...(layout.xaxis || {}),
			title: showAxes ? currentAxisTitles.x : "",
			showgrid: showGrid,
			showline: showAxes,
			showticklabels: showAxes,
			zeroline: showAxes && showGrid,
		},
		yaxis: {
			...(layout.yaxis || {}),
			title: showAxes ? currentAxisTitles.y : "",
			scaleanchor: appearance.lockAspect ? "x" : false,
			scaleratio: appearance.lockAspect ? 1 : undefined,
			showgrid: showGrid,
			showline: showAxes,
			showticklabels: showAxes,
			zeroline: showAxes && showGrid,
		},
	};
}

function renderPlot(data, layout) {
	currentRenderedData = data;
	currentRenderedLayout = layout;

	Plotly.react(scatterPlotDiv, data, layout, plotConfig)
		.then(() => {
			attachWheelZoom();
			schedulePlotResize();
		})
		.catch((error) => {
			console.error("Failed to render plot:", error);
		});
}

function applyPlotAppearance() {
	applyMarkerStyle();
	applyPlotLayoutAppearance();
}

function applyMarkerStyle() {
	if (!isPlotReady()) return;

	const appearance = getCurrentPlotAppearance();
	if (currentRenderedData) {
		currentRenderedData = currentRenderedData.map((trace) => ({
			...trace,
			marker: {
				...(trace.marker || {}),
				size: appearance.marker.size,
				opacity: appearance.marker.opacity,
			},
		}));
	}

	Plotly.restyle(scatterPlotDiv, {
		"marker.size": appearance.marker.size,
		"marker.opacity": appearance.marker.opacity,
	});
}

function applyPlotLayoutAppearance() {
	if (!currentRenderedData || !currentRenderedLayout) return;

	const appearance = getCurrentPlotAppearance();
	const nextLayout = mergePlotAppearanceIntoLayout(currentRenderedLayout, appearance);
	renderPlot(currentRenderedData, withPlotTheme(nextLayout));
}

function schedulePlotUpdate(update) {
	if (pendingMarkerStyleFrame !== null) return;

	pendingMarkerStyleFrame = requestAnimationFrame(() => {
		pendingMarkerStyleFrame = null;
		update();
	});
}

function scheduleMarkerStyleUpdate() {
	schedulePlotUpdate(applyMarkerStyle);
}

function schedulePlotLayoutUpdate() {
	schedulePlotUpdate(applyPlotLayoutAppearance);
}

function schedulePlotAppearanceUpdate() {
	schedulePlotUpdate(applyPlotAppearance);
}

function schedulePlotResize() {
	if (pendingResizeFrame !== null) return;

	pendingResizeFrame = requestAnimationFrame(() => {
		pendingResizeFrame = null;
		if (isPlotReady()) Plotly.Plots.resize(scatterPlotDiv);
	});
}

function getAxisRanges() {
	const xaxis = scatterPlotDiv?._fullLayout?.xaxis;
	const yaxis = scatterPlotDiv?._fullLayout?.yaxis;
	if (!xaxis?.range || !yaxis?.range) return null;

	return {
		x: [Number(xaxis.range[0]), Number(xaxis.range[1])],
		y: [Number(yaxis.range[0]), Number(yaxis.range[1])],
	};
}

function getPlotPointerFractions(event) {
	const size = scatterPlotDiv?._fullLayout?._size;
	if (!size) return null;

	const rect = scatterPlotDiv.getBoundingClientRect();
	const plotX = event.clientX - rect.left - size.l;
	const plotY = event.clientY - rect.top - size.t;

	return {
		x: Math.min(Math.max(plotX / size.w, 0), 1),
		y: Math.min(Math.max(plotY / size.h, 0), 1),
	};
}

function zoomRanges(ranges, pointer, zoomFactor) {
	const xSpan = ranges.x[1] - ranges.x[0];
	const ySpan = ranges.y[1] - ranges.y[0];
	const xValue = ranges.x[0] + pointer.x * xSpan;
	const yValue = ranges.y[1] - pointer.y * ySpan;
	const nextXSpan = xSpan * zoomFactor;
	const nextYSpan = ySpan * zoomFactor;

	return {
		x: [xValue - pointer.x * nextXSpan, xValue + (1 - pointer.x) * nextXSpan],
		y: [yValue - (1 - pointer.y) * nextYSpan, yValue + pointer.y * nextYSpan],
	};
}

function scheduleWheelZoomRelayout() {
	if (pendingWheelZoomFrame !== null) return;

	pendingWheelZoomFrame = requestAnimationFrame(() => {
		pendingWheelZoomFrame = null;
		if (!pendingWheelRanges || !currentRenderedData || !currentRenderedLayout) return;

		const ranges = pendingWheelRanges;
		pendingWheelRanges = null;
		const nextLayout = {
			...currentRenderedLayout,
			xaxis: {
				...(currentRenderedLayout.xaxis || {}),
				range: ranges.x,
			},
			yaxis: {
				...(currentRenderedLayout.yaxis || {}),
				range: ranges.y,
			},
		};
		renderPlot(currentRenderedData, nextLayout);
	});
}

function handlePlotWheelZoom(event) {
	if (!scatterPlotDiv?._fullLayout) return;
	const pointer = getPlotPointerFractions(event);
	const currentRanges = pendingWheelRanges || getAxisRanges();
	if (!pointer || !currentRanges) return;

	event.preventDefault();
	event.stopPropagation();

	const zoomFactor = Math.exp(event.deltaY * wheelZoomSpeed);
	pendingWheelRanges = zoomRanges(currentRanges, pointer, zoomFactor);
	scheduleWheelZoomRelayout();
}

function attachWheelZoom() {
	if (!scatterPlotDiv || wheelZoomAttached) return;
	scatterPlotDiv.addEventListener("wheel", handlePlotWheelZoom, { passive: false });
	wheelZoomAttached = true;
}

function getTitleText(title) {
	if (!title) return "";
	if (typeof title === "string") return title;
	return title.text || "";
}

function getAxisTitle(axis) {
	if (!axis || !axis.title) return "";
	if (typeof axis.title === "string") return axis.title;
	return axis.title.text || "";
}

function resetPlotAppearanceControls() {
	if (pointSizeSlider) pointSizeSlider.value = defaultPointSize;
	if (opacitySlider) opacitySlider.value = defaultOpacity;
	if (pointSizeValue) pointSizeValue.textContent = defaultPointSize;
	if (opacityValue) opacityValue.textContent = defaultOpacity;
	if (showLegendCheckbox) showLegendCheckbox.checked = defaultBooleanControls.showLegend;
	if (showGridCheckbox) showGridCheckbox.checked = defaultBooleanControls.showGrid;
	if (showAxesCheckbox) showAxesCheckbox.checked = defaultBooleanControls.showAxes;
	if (lockAspectCheckbox) lockAspectCheckbox.checked = defaultBooleanControls.lockAspect;
}

function clearAllSelections() {
	if (colorBySelect) colorBySelect.value = "select_cluster_type";
	if (metadataColNameSelect) {
		metadataColNameSelect.value = "select_metadata_column";
		metadataColSelectionDiv.classList.add("hidden");
	}
	if (tfNameSelect) {
		tfNameSelect.value = "select_tf";
		tfSelectionDiv.classList.add("hidden");
		changeThresholdTypeDiv.classList.add("hidden");
	}
	if (geneEntryInput) {
		geneEntryInput.value = "";
		geneEntryDiv.classList.add("hidden");
		colorScaleSelectionDiv.classList.add("hidden");
	}
	resetPlotAppearanceControls();
	if (fdrLevel) fdrLevel.value = "";
	if (pValueThreshold) pValueThreshold.value = "";
}

plotTypeSelect.addEventListener("change", function () {
	clearAllSelections();

	const apiUrl = `/analysis/plot/${window.analysis.id}`;
	getPlotData(apiUrl, "POST", { plot_type: this.value })
		.then(() => {
			console.log("Plot loaded successfully.");
		})
		.catch((err) => {
			alert("Failed to load plot. Please try again later.");
		});
});

colorScaleSelectionDiv.addEventListener("change", function (e) {
	console.log("ColorScaleSelectionDiv changed successfully.");
	if (!scatterPlotDiv || !scatterPlotDiv.data) return;
	if (currentRenderedData) {
		currentRenderedData = currentRenderedData.map((trace, index) => {
			if (index !== 0) return trace;
			return {
				...trace,
				marker: {
					...(trace.marker || {}),
					colorscale: e.target.value,
				},
			};
		});
	}
	Plotly.restyle(
		scatterPlotDiv,
		{
			"marker.colorscale": [e.target.value],
		},
		[0],
	);
});

if (pointSizeSlider && pointSizeValue) {
	pointSizeSlider.addEventListener("input", function (e) {
		pointSizeValue.textContent = e.target.value;
		scheduleMarkerStyleUpdate();
	});
}

if (opacitySlider && opacityValue) {
	opacitySlider.addEventListener("input", function (e) {
		opacityValue.textContent = e.target.value;
		scheduleMarkerStyleUpdate();
	});
}

[
	showLegendCheckbox,
	showGridCheckbox,
	showAxesCheckbox,
	lockAspectCheckbox,
].forEach((control) => {
	if (control) control.addEventListener("change", schedulePlotLayoutUpdate);
});

if (resetPlotStyleBtn) {
	resetPlotStyleBtn.addEventListener("click", function () {
		resetPlotAppearanceControls();
		schedulePlotAppearanceUpdate();
	});
}

if (downloadPlotPngBtn) {
	downloadPlotPngBtn.addEventListener("click", function () {
		if (!isPlotReady()) return;
		const sanitizeFilename = (value) =>
			String(value || "analysis")
				.trim()
				.replace(/[^a-z0-9-_]+/gi, "-")
				.replace(/^-+|-+$/g, "")
				.toLowerCase();
		const plotName = sanitizeFilename(plotTitle?.textContent) || "analysis-plot";
		const analysisName = sanitizeFilename(window.analysis.name) || "analysis";
		Plotly.downloadImage(scatterPlotDiv, {
			format: "png",
			filename: `${analysisName}-${plotName}`,
			width: 1400,
			height: 1000,
			scale: 2,
		});
	});
}

if (colorBySelect) {
	colorBySelect.addEventListener("change", function () {
		if (this.value === "tf_activity") {
			tfSelectionDiv.classList.remove("hidden");
			metadataColSelectionDiv.classList.add("hidden");
			geneEntryDiv.classList.add("hidden");
			colorScaleSelectionDiv.classList.add("hidden");
			changeThresholdTypeDiv.classList.remove("hidden");

			metadataColNameSelect.value = "select_metadata_column";
			geneEntryInput.value = "";
		} else if (this.value === "tf_activity_score") {
			tfSelectionDiv.classList.remove("hidden");
			metadataColSelectionDiv.classList.add("hidden");
			geneEntryDiv.classList.add("hidden");
			colorScaleSelectionDiv.classList.remove("hidden");
			changeThresholdTypeDiv.classList.add("hidden");

			metadataColNameSelect.value = "select_metadata_column";
			fdrLevel.value = "";
			pValueThreshold.value = "";
			geneEntryInput.value = "";
		} else if (this.value === "metadata_columns") {
			tfSelectionDiv.classList.add("hidden");
			metadataColSelectionDiv.classList.remove("hidden");
			geneEntryDiv.classList.add("hidden");
			colorScaleSelectionDiv.classList.add("hidden");
			changeThresholdTypeDiv.classList.add("hidden");

			tfNameSelect.value = "select_tf";
			fdrLevel.value = "";
			pValueThreshold.value = "";
			geneEntryInput.value = "";
		} else if (this.value === "gene_expression") {
			geneEntryDiv.classList.remove("hidden");
			colorScaleSelectionDiv.classList.remove("hidden");
			tfSelectionDiv.classList.add("hidden");
			metadataColSelectionDiv.classList.add("hidden");
			changeThresholdTypeDiv.classList.add("hidden");

			tfNameSelect.value = "select_tf";
			fdrLevel.value = "";
			pValueThreshold.value = "";
			metadataColNameSelect.value = "select_metadata_column";
		} else {
			geneEntryDiv.classList.add("hidden");
			colorScaleSelectionDiv.classList.add("hidden");
			tfSelectionDiv.classList.add("hidden");
			metadataColSelectionDiv.classList.add("hidden");
			changeThresholdTypeDiv.classList.add("hidden");
		}
	});
}

fdrCorrectionRadio.addEventListener("click", function () {
	if (this.checked) {
		pValueThreshold.disabled = true;
		fdrLevel.disabled = false;
	}
});
pValueThresholdRadio.addEventListener("click", function () {
	if (this.checked) {
		pValueThreshold.disabled = false;
		fdrLevel.disabled = true;
	}
});

function updatePlot(plot_data) {
	if (plot_data.data && plot_data.layout) {
		const totalCellsCount = plot_data.data.reduce(
			(acc, trace) => acc + (trace.x ? trace.x.length : 0),
			0,
		);
		currentHoverDisabledBySize = totalCellsCount > hoverPointLimit;
		currentAxisTitles = {
			x: getAxisTitle(plot_data.layout.xaxis),
			y: getAxisTitle(plot_data.layout.yaxis),
		};
		const appearance = getCurrentPlotAppearance();
		const markerStyle = appearance.marker;
		const data = plot_data.data.map((trace) => {
			const pointCount = trace.x ? trace.x.length : 0;
			const label = String(trace.cluster || trace.name || "");
			const marker = {
				...(trace.marker || {}),
				size: markerStyle.size,
				opacity: markerStyle.opacity,
				line: { width: 0, ...((trace.marker || {}).line || {}) },
			};

			if (Array.isArray(marker.color)) marker.color = toFloat32Array(marker.color);

			return {
				...trace,
				cluster: label,
				name: label ? `${label} (${pointCount.toLocaleString()})` : trace.name,
				x: toFloat32Array(trace.x),
				y: toFloat32Array(trace.y),
				hoverinfo: currentHoverDisabledBySize ? "skip" : trace.hoverinfo,
				marker,
			};
		});
		const nextRevision = ++plotRevision;
		const layout = withPlotTheme({
			...plot_data.layout,
			dragmode: "pan",
			hovermode: currentHoverDisabledBySize ? false : "closest",
			showlegend: appearance.showLegend,
			legend: defaultLegendLayout,
			margin: {
				l: 15,
				r: 15,
				t: 30,
				b: 15,
			},
			autosize: true,
			uirevision: plotTypeSelect ? plotTypeSelect.value : "analysis-plot",
			datarevision: nextRevision,
			xaxis: {
				...(plot_data.layout.xaxis || {}),
				title: appearance.showAxes ? currentAxisTitles.x : "",
				automargin: true,
				constrain: "range",
				constraintoward: "center",
				showgrid: appearance.showGrid,
				showline: appearance.showAxes,
				showticklabels: appearance.showAxes,
				zeroline: appearance.showAxes && appearance.showGrid,
			},
			yaxis: {
				...(plot_data.layout.yaxis || {}),
				title: appearance.showAxes ? currentAxisTitles.y : "",
				automargin: true,
				scaleanchor: appearance.lockAspect ? "x" : null,
				scaleratio: appearance.lockAspect ? 1 : null,
				constrain: "range",
				constraintoward: "center",
				showgrid: appearance.showGrid,
				showline: appearance.showAxes,
				showticklabels: appearance.showAxes,
				zeroline: appearance.showAxes && appearance.showGrid,
			},
		});

		totalCells.textContent = `Total Cells: ${totalCellsCount.toLocaleString()}`;
		renderPlot(data, layout);

		if (plot_data.fdr_level) fdrLevel.value = plot_data.fdr_level;

		if (plot_data.p_value_threshold) pValueThreshold.value = plot_data.p_value_threshold;

		if (plot_data.layout.title) plotTitle.textContent = getTitleText(plot_data.layout.title);

		if (plot_data.p_value_threshold) pValueThreshold.value = plot_data.p_value_threshold;
	} else throw new Error("Received data is not in the expected format.");
}

metadataColNameSelect.addEventListener("change", function () {
	if (this.value !== "select_metadata_column") {
		const apiUrl = `/analysis/metadata-cluster/${window.analysis.id}`;

		updatePlotData(apiUrl, "POST", {
			selected_metadata_cluster: this.value,
			plot_type: plotTypeSelect.value,
		})
			.then(() => {
				console.log("Metadata cluster plot loaded successfully.");
			})
			.catch((err) => {
				console.error("Failed to load plot:", err);
				alert("Failed to load plot. Please try again later.");
			});
	}
});

function changeFDRThreshold() {
	const apiUrl = `/analysis/change-fdr-tf/${window.analysis.id}`;

	updatePlotData(apiUrl, "POST", {
		fdr_level: fdrLevel && fdrLevel.value ? fdrLevel.value : 0.1,
		tf_name: tfNameSelect.value,
		plot_type: plotTypeSelect.value,
	})
		.then(() => {
			console.log("FDR correction applied successfully.");
		})
		.catch((err) => {
			console.error("Failed to apply FDR correction:", err);
			alert("Failed to apply FDR correction. Please try again later.");
		});
}
function changePValueThreshold() {
	if (pValueThreshold.value) {
		const apiUrl = `/analysis/change-pvalue-threshold-tf/${window.analysis.id}`;

		updatePlotData(apiUrl, "POST", {
			pvalue_threshold: pValueThreshold.value,
			tf_name: tfNameSelect.value,
			plot_type: plotTypeSelect.value,
		})
			.then(() => {
				console.log("P-value threshold applied successfully.");
			})
			.catch((err) => {
				console.error("Failed to apply P-value threshold:", err);
				alert("Failed to apply P-value threshold. Please try again later.");
			});
	} else {
		alert("Please enter a valid P-value threshold.");
	}
}

function showTfActivityScore() {
	const apiUrl = `/analysis/tf-activity-score/${window.analysis.id}`;

	updatePlotData(apiUrl, "POST", {
		tf_name: tfNameSelect.value,
		plot_type: plotTypeSelect.value,
	})
		.then(() => {
			console.log("TF activity score plot loaded successfully.");
		})
		.catch((err) => {
			console.error("Failed to load TF activity score:", err);
			alert("Failed to load TF activity score. Please try again later.");
		});
}

tfNameSelect.addEventListener("change", function () {
	if (this.value !== "select_tf") {
		if (colorBySelect.value === "tf_activity_score") showTfActivityScore();
		else if (colorBySelect.value === "tf_activity") {
			if (fdrCorrectionRadio.checked) changeFDRThreshold();
			else changePValueThreshold();
		}
	} else {
		alert("Please select a valid transcription factor.");
	}
});

applyCorrectionBtn.addEventListener("click", function (e) {
	if (colorBySelect.value !== "tf_activity") return;
	if (fdrCorrectionRadio.checked) changeFDRThreshold();
	else changePValueThreshold();
});

geneEntryInput.addEventListener("keypress", function (event) {
	if (event.key === "Enter") {
		let gene_name = this.value.trim();
		if (gene_name) {
			const apiUrl = `/analysis/gene-expression/${window.analysis.id}`;

			updatePlotData(apiUrl, "POST", { selected_gene: gene_name, plot_type: plotTypeSelect.value })
				.then(() => {
					console.log("Gene expression plot loaded successfully.");
				})
				.catch((err) => {
					console.error("Failed to load plot:", err);
					alert("Failed to load plot. Please try again later.");
				});
		} else {
			alert("Please enter a valid gene name.");
		}
	}
});

if (plotConfigForm) {
	plotConfigForm.addEventListener("submit", function (event) {
		event.preventDefault();
		applyPlotAppearance();
	});
}

async function updatePlotData(apiUrl, method, body) {
	plotLoadingSpinner.style.display = "block";

	try {
		// 1. Make the API request
		const response = await fetch(apiUrl, {
			method: method,
			headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
			body: body ? JSON.stringify(body) : null,
		});

		// 2. Check for HTTP errors first. If the response is not ok, process the error and throw.
		if (!response.ok) {
			let errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
			try {
				const errorData = await response.json();
				errorMessage = errorData.error || errorMessage;
			} catch (e) {
				alert("Failed to parse error response as JSON.");
				console.warn("Failed to parse error response as JSON:", e);
			}
			throw new Error(errorMessage);
		}

		// Update coordinates and layout
		const data = await response.json();
		updatePlot(data);
	} catch (error) {
		console.error("Error in updatePlotData:", error);
		alert(`Error loading plot: ${error.message}`);
	} finally {
		plotLoadingSpinner.style.display = "none";
	}
}

async function getPlotData(apiUrl, method, body) {
	plotLoadingSpinner.style.display = "block";

	try {
		// 1. Make the API request
		const response = await fetch(apiUrl, {
			method: method,
			headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
			body: body ? JSON.stringify(body) : undefined,
		});

		// 2. Check for HTTP errors first. If the response is not ok, process the error and throw.
		if (!response.ok) {
			let errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
			try {
				const errorData = await response.json();
				errorMessage = errorData.error || errorMessage;
			} catch (e) {
				alert("Failed to parse error response as JSON.");
				console.warn("Failed to parse error response as JSON:", e);
			}
			throw new Error(errorMessage);
		}

		const data = await response.json();

		updatePlot(data);
	} catch (error) {
		console.error("Error loading plot data:", error);
		alert(`Error loading plot: ${error.message}`);
	} finally {
		plotLoadingSpinner.style.display = "none";
	}
}

document.addEventListener("DOMContentLoaded", function () {
	addInputValidation("fdr-level", 0.0, 1.0);
	addInputValidation("p-val-threshold", 0.0, 1.0);

	if (window.appTheme) window.appTheme.onChange(refreshScatterPlotTheme);

	getPlotData(`/analysis/plot/${window.analysis.id}`, "POST", { plot_type: "umap_plot" })
		.then(() => {
			console.log("Plot loaded successfully.");
		})
		.catch((err) => {
			alert("Failed to load plot. Please try again later.");
		});

	window.addEventListener("resize", () => {
		schedulePlotResize();
	});

	if (moreInfoBtn && modal && closeModalBtn) {
		moreInfoBtn.addEventListener("click", () => {
			modal.classList.remove("hidden");
		});
		closeModalBtn.addEventListener("click", () => {
			modal.classList.add("hidden");
		});
		modal.addEventListener("click", (e) => {
			if (e.target === modal) {
				modal.classList.add("hidden");
			}
		});
		document.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				modal.classList.add("hidden");
			}
		});
	}
});
