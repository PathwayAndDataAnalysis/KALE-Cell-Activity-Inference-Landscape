import shutil
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import lru_cache
import os

import psutil
from werkzeug.utils import secure_filename
import pandas as pd
from flask import current_app, jsonify
import scanpy as sc
import numpy as np
import pyarrow.parquet as pq
from . import get_file_path, update_all_users_data
from scipy.sparse import issparse

executor = ThreadPoolExecutor(max_workers=4)  # Adjust as needed

MAX_FILE_SIZE = 500 * 1024 * 1024 * 1024  # 500 GB
MIN_DISK_SPACE = 10 * 1024 * 1024 * 1024  # 10 GB
UPLOAD_DISK_RESERVE = 256 * 1024 * 1024  # 256 MB
MIN_PROCESSING_MEMORY = 512 * 1024 * 1024  # 512 MB

# Define constants for column names
CLUSTER_COL = "Cluster"
UMAP1_COL = "X_umap1"
UMAP2_COL = "X_umap2"
PCA1_COL = "X_pca1"
PCA2_COL = "X_pca2"

TF_ACTIVITY_COLORS = {
    "Active": "red",
    "Inactive": "blue",
    "Insignificant": "gray",
    "Not_Enough_Data": "yellow",
}
TF_ACTIVITY_LABELS = {
    1: "Active",
    -1: "Inactive",
    0: "Insignificant",
}


def get_plot_axis_columns(plot_type):
    normalized_plot_type = (plot_type or "").lower()
    if normalized_plot_type == "umap_plot":
        return UMAP1_COL, UMAP2_COL, "UMAP Plot"
    if normalized_plot_type == "pca_plot":
        return PCA1_COL, PCA2_COL, "PCA Plot"
    return None


@lru_cache(maxsize=16)
def _read_layout_columns_cached(layout_filepath, delimiter, file_mtime_ns, file_size, columns):
    header = pd.read_csv(layout_filepath, sep=delimiter, nrows=0)
    requested_columns = tuple(dict.fromkeys(columns))
    missing_columns = [column for column in requested_columns if column not in header.columns]
    if missing_columns:
        raise ValueError(f"Layout file is missing required columns: {', '.join(missing_columns)}")

    index_column = header.columns[0]
    usecols = [index_column, *[column for column in requested_columns if column != index_column]]
    return pd.read_csv(layout_filepath, index_col=0, sep=delimiter, usecols=usecols)


def read_layout_columns(layout_filepath, columns):
    file_stat = os.stat(layout_filepath)
    delimiter = infer_delimiter(layout_filepath)
    layout_df = _read_layout_columns_cached(
        layout_filepath,
        delimiter,
        file_stat.st_mtime_ns,
        file_stat.st_size,
        tuple(dict.fromkeys(columns)),
    )
    return layout_df.copy(deep=False)


def _series_to_plotly_values(series):
    return pd.to_numeric(series, errors="coerce").tolist()


def _make_scattergl_trace(label, group_df, x_col, y_col, marker=None):
    return {
        "cluster": str(label),
        "x": _series_to_plotly_values(group_df[x_col]),
        "y": _series_to_plotly_values(group_df[y_col]),
        "mode": "markers",
        "type": "scattergl",
        "name": str(label),
        "marker": marker or {},
    }


def _with_string_index(df):
    df = df.copy(deep=False)
    df.index = df.index.astype(str)
    return df


def get_activity_scores_path(analysis):
    activity_scores_path = analysis.get("activity_scores_path") or analysis.get(
        "activation_path"
    )
    if not activity_scores_path or not os.path.exists(activity_scores_path):
        raise FileNotFoundError("Activity scores file not found for this analysis.")
    return activity_scores_path


def get_activity_tf_names(analysis):
    try:
        schema = pq.read_schema(get_activity_scores_path(analysis))
    except Exception as exc:
        current_app.logger.warning(
            "Unable to read activity score columns for analysis_id='%s': %s",
            analysis.get("id"),
            exc,
        )
        return analysis.get("tfs", [])

    index_columns = {"__index_level_0__", "index"}
    return [name for name in schema.names if name not in index_columns]


def get_analysis_metadata_df(analysis, user_id):
    gene_expression = analysis.get("inputs", {}).get("gene_expression", {})
    metadata_filepath = gene_expression.get("metadata_filepath")
    h5ad_file = gene_expression.get("h5ad_filepath")

    if metadata_filepath:
        metadata_path = get_file_path(metadata_filepath, user_id)
        metadata_df = pd.read_csv(
            metadata_path, index_col=0, sep=infer_delimiter(metadata_path)
        )
        return _with_string_index(metadata_df)
    if h5ad_file:
        adata = sc.read_h5ad(get_file_path(h5ad_file, user_id))
        return _with_string_index(pd.DataFrame(adata.obs))

    raise ValueError("No metadata source is available for this analysis.")


def generate_tf_activity_score_plot(analysis, tf_name, plot_type="umap_plot"):
    activity_scores_path = get_activity_scores_path(analysis)
    available_tfs = get_activity_tf_names(analysis)
    if tf_name not in available_tfs:
        raise ValueError("Invalid transcription factor specified.")

    layout_filepath = analysis.get("inputs", {}).get("layout", {}).get("layout_filepath")
    if not layout_filepath or not os.path.exists(layout_filepath):
        raise FileNotFoundError("Layout file not found.")

    plot_columns = get_plot_axis_columns(plot_type)
    if not plot_columns:
        raise ValueError("Invalid plot type specified.")
    x_col, y_col, base_title = plot_columns

    plot_df = _with_string_index(read_layout_columns(layout_filepath, [x_col, y_col]))
    activity_scores_tf = pd.read_parquet(
        activity_scores_path, use_threads=True, columns=[tf_name]
    )
    activity_scores_tf = _with_string_index(activity_scores_tf)
    plot_df = plot_df.join(activity_scores_tf, how="inner")
    score_values = pd.to_numeric(plot_df[tf_name], errors="coerce")

    finite_abs_scores = np.abs(score_values[np.isfinite(score_values)])
    color_limit = (
        float(np.nanpercentile(finite_abs_scores, 99))
        if len(finite_abs_scores) > 0
        else 1.0
    )
    color_limit = max(color_limit, 1.0)

    trace = {
        "x": _series_to_plotly_values(plot_df[x_col]),
        "y": _series_to_plotly_values(plot_df[y_col]),
        "mode": "markers",
        "type": "scattergl",
        "name": tf_name,
        "marker": {
            "color": score_values.tolist(),
            "colorscale": "RdBu",
            "reversescale": True,
            "showscale": True,
            "cmin": -color_limit,
            "cmax": color_limit,
            "colorbar": {"title": "Score"},
        },
    }
    layout = {
        "title": f"{base_title} Colored by {tf_name} Activity Score",
        "xaxis": {"title": x_col},
        "yaxis": {"title": y_col},
    }
    return {
        "data": [trace],
        "layout": layout,
        "plot_kind": "embedding",
        "tf_activity_score": tf_name,
    }


def run_in_background(fn, *args, **kwargs):
    app = current_app._get_current_object()

    def wrapped(*args, **kwargs):
        with app.app_context():
            try:
                return fn(*args, **kwargs)
            except Exception as e:
                current_app.logger.error(f"Background job {fn.__name__} failed: {e}")
                raise e

    current_app.logger.info(
        f"[UTILS] Submitting background job: {fn.__name__} with args={args} kwargs={kwargs}"
    )
    future = executor.submit(wrapped, *args, **kwargs)
    current_app.logger.info(f"[UTILS] Background job {fn.__name__} submitted. Future: {future}")
    return future


def _get_summary_stats(data_series):
    """
    Calculates summary statistics for a pandas Series, handling NaNs.
    """
    stats = data_series.describe()
    if stats.get("count", 0.0) == 0.0:
        return {
            "mean": 0.0,
            "sd": 0.0,
            "min": 0.0,
            "max": 0.0
        }
    return {
        "mean": round(float(stats.get("mean", 0)), 2),
        "sd": round(float(stats.get("std", 0)), 2),
        "min": round(float(stats.get("min", 0)), 2),
        "max": round(float(stats.get("max", 0)), 2),
    }


def calculate_and_save_qc_metrics(user_id, filename, file_path):
    """
    Reads an uploaded file, calculates QC metrics using Scanpy,
    and saves the histogram data to users.json.
    """
    try:
        if not file_path:
            current_app.logger.error(f"Error: Could not find path for {filename} for user {user_id}")
            return

        BINS = 100
        qc_results = {}

        # Read data into AnnData object
        if filename.endswith('.h5ad'):
            adata = sc.read_h5ad(file_path)

            # Sparse matrices expose non-zero values directly; dense matrices need filtering.
            if issparse(adata.X):
                non_zero_expr = adata.X.data
            else:
                expr_values = np.asarray(adata.X).ravel()
                non_zero_expr = expr_values[expr_values != 0]
            non_zero_expr = np.asarray(non_zero_expr)
            non_zero_expr = non_zero_expr[np.isfinite(non_zero_expr)]

            if non_zero_expr.size > 0:
                # Calculate histogram only on the non-zero values
                expr_counts, expr_bins = np.histogram(non_zero_expr, bins=BINS)

                # Calculate the number of zero values separately
                total_elements = adata.n_obs * adata.n_vars
                num_zeros = total_elements - len(non_zero_expr)

                # Add the count of zeros to the first bin of the histogram
                expr_counts[0] += num_zeros

                expr_stats = {
                    "mean": round(float(non_zero_expr.sum() / total_elements), 3),  # Mean across all elements
                    "sd": round(float(np.std(non_zero_expr)), 2),
                    "min": round(float(np.min(non_zero_expr)), 2),
                    "max": round(float(np.max(non_zero_expr)), 2),
                }
            else:
                expr_counts, expr_bins = [], []
                expr_stats = {"mean": 0.0, "sd": 0.0, "min": 0.0, "max": 0.0}

            qc_results["gene_expression"] = {
                "counts": expr_counts.tolist(),
                "bins": expr_bins.tolist(),
                **expr_stats
            }

        else:  # For .tsv, .csv
            # Infer delimiter based on file extension
            delimiter = infer_delimiter(file_path)
            gene_exp_df = pd.read_csv(file_path, index_col=0, delimiter=delimiter)
            adata = sc.AnnData(gene_exp_df)

            expr_flat = gene_exp_df.values.flatten()
            expr_flat = expr_flat[np.isfinite(expr_flat)]  # remove NaN/Inf
            if expr_flat.size > 0:
                expr_counts, expr_bins = np.histogram(expr_flat, bins=BINS)
                expr_stats = {
                    "mean": round(float(np.mean(expr_flat)), 2),
                    "sd": round(float(np.std(expr_flat)), 2),
                    "min": round(float(np.min(expr_flat)), 2),
                    "max": round(float(np.max(expr_flat)), 2),
                }
            else:
                expr_counts, expr_bins = [], []
                expr_stats = {"mean": 0.0, "sd": 0.0, "min": 0.0, "max": 0.0}
            qc_results["gene_expression"] = {
                "counts": expr_counts.tolist(),
                "bins": expr_bins.tolist(),
                **expr_stats
            }

        # Identify mitochondrial genes (works for both human 'MT-' and mouse 'mt-')
        adata.var['mt'] = adata.var_names.str.startswith(('MT-', 'mt-'))
        sc.pp.calculate_qc_metrics(adata, qc_vars=['mt'], percent_top=None, log1p=False, inplace=True)

        # Generate histogram data (lightweight for JSON storage)
        metrics = {
            "n_genes_by_counts": adata.obs['n_genes_by_counts'],  # Genes per cell
            "n_cells_by_counts": adata.var['n_cells_by_counts'],  # Cells per gene
            "pct_counts_mt": adata.obs['pct_counts_mt'],  # MT percentage
        }

        for name, data in metrics.items():
            valid_data = data.dropna()
            if not valid_data.empty:
                counts, bins = np.histogram(valid_data, bins=BINS)
                qc_results[name] = {
                    "counts": counts.tolist(),
                    "bins": bins.tolist(),
                    **_get_summary_stats(valid_data)
                }
            else:
                qc_results[name] = {"counts": [], "bins": []}

        qc_status = "completed"

    except Exception as e:
        current_app.logger.error(f"Error calculating QC for {filename}: {e}")
        qc_results = {}
        qc_status = "failed"

    def save_qc_results(all_users_data):
        user_node = all_users_data.get(user_id)
        if user_node and 'files' in user_node:
            for i, file_info in enumerate(user_node['files']):
                if file_info['filename'] == filename:
                    # Add qc metrics and status to the file's record
                    all_users_data[user_id]['files'][i]['qc_metrics'] = qc_results
                    all_users_data[user_id]['files'][i]['qc_status'] = qc_status
                    break

    update_all_users_data(save_qc_results)
    current_app.logger.info(
        f"[UTILS] QC metrics for {filename} saved successfully for user {user_id}."
    )


def update_analysis_status(
    user_id,
    analysis_id,
    status,
    umap_csv_path=None,
    metadata_cols=None,
    tfs=None,
    pvalues_path=None,
    activation_path=None,
    activity_scores_path=None,
    bh_reject_path=None,
    fdr_level=None,
    p_value_threshold=None,
    p_val_threshold_path=None,
    z_scores_path=None,
    error=None,
):
    try:
        current_app.logger.info(
            f"[UTILS] Updating analysis status: user_id={user_id}, analysis_id={analysis_id}, status={status}, error={error}"
        )

        found = False

        def save_status_update(all_users_data):
            nonlocal found
            user_node = all_users_data.get(user_id, {})

            if not user_node:
                current_app.logger.error(f"[UTILS] User {user_id} not found in users data")
                return

            for analysis in user_node.get("analyses", []):
                if analysis["id"] == analysis_id:
                    if status:
                        analysis["status"] = status
                    if metadata_cols is not None:
                        analysis["metadata_cols"] = metadata_cols
                    if tfs is not None:
                        analysis["tfs"] = tfs
                    if pvalues_path:
                        analysis["pvalues_path"] = pvalues_path
                    if activation_path:
                        analysis["activation_path"] = activation_path
                    if activity_scores_path:
                        analysis["activity_scores_path"] = activity_scores_path
                    if bh_reject_path:
                        analysis["bh_reject_path"] = bh_reject_path
                    if p_value_threshold is not None or fdr_level is not None:
                        if p_value_threshold is not None:
                            analysis.get("inputs")["p_value_threshold"] = p_value_threshold
                            if "fdr_level" in analysis.get("inputs", {}):
                                del analysis["inputs"]["fdr_level"]
                        else:
                            analysis["inputs"]["fdr_level"] = fdr_level
                            if "p_value_threshold" in analysis.get("inputs", {}):
                                del analysis["inputs"]["p_value_threshold"]
                    if p_val_threshold_path:
                        analysis["p_val_threshold_path"] = p_val_threshold_path
                    if z_scores_path:
                        analysis["z_scores_path"] = z_scores_path
                    if umap_csv_path:
                        layout = analysis.get("inputs", {}).get("layout", {})
                        layout["layout_filepath"] = umap_csv_path
                    if error:
                        analysis["error"] = error
                        analysis["error_timestamp"] = datetime.now().isoformat()
                    found = True
                    break

        update_all_users_data(save_status_update)

        if found:
            current_app.logger.info(
                f"[UTILS] Analysis status updated and saved for analysis_id={analysis_id}."
            )
        else:
            current_app.logger.warning(
                f"[UTILS] Analysis with id={analysis_id} not found for user_id={user_id}. No update performed."
            )

    except Exception as e:
        current_app.logger.error(f"[UTILS] Error updating analysis status: {e}")
        # Don't raise the exception to prevent cascading failures


def infer_delimiter(filepath):
    ext = filepath.split('.')[-1]
    if ext == 'tsv':
        return '\t'
    elif ext == 'csv':
        return ','
    else:
        current_app.logger.warning(
            f"[UTILS] Unsupported file extension '{ext}' for delimiter inference. Defaulting to comma."
        )
        return ','


def check_system_resources(
    require_memory=True,
    *,
    disk_path=None,
    required_disk_space=0,
    min_free_disk_space=None,
):
    """Check disk capacity and, optionally, memory availability."""
    try:
        disk_path = disk_path or current_app.config["UPLOAD_FOLDER"]
        os.makedirs(disk_path, exist_ok=True)

        if min_free_disk_space is None:
            min_free_disk_space = current_app.config.get("MIN_DISK_SPACE", MIN_DISK_SPACE)

        required_disk_space = max(0, int(required_disk_space or 0))
        min_free_disk_space = max(0, int(min_free_disk_space or 0))
        required_free_space = required_disk_space + min_free_disk_space

        disk_usage = shutil.disk_usage(disk_path)
        if disk_usage.free < required_free_space:
            raise ValueError(
                "Insufficient disk space. "
                f"Available: {disk_usage.free / (1024 ** 2):.1f} MB; "
                f"required: {required_free_space / (1024 ** 2):.1f} MB."
            )

        # Check memory
        if require_memory:
            memory = psutil.virtual_memory()
            if memory.available < MIN_PROCESSING_MEMORY:
                raise ValueError(
                    f"Insufficient memory available. Need at least {MIN_PROCESSING_MEMORY / (1024 ** 2):.0f} MB free."
                )

        return True
    except Exception as e:
        current_app.logger.error(f"System resource check failed: {e}")
        return False


def get_user_specific_data_path(username):
    """Returns the path to a user's dedicated data directory."""
    # current_app.config['UPLOAD_FOLDER'] is the root for all user uploads
    base_upload_folder = current_app.config["UPLOAD_FOLDER"]
    # Sanitize username for directory creation, though secure_filename is usually for files
    safe_username_dir = secure_filename(username)  # Ensures username is safe for path
    path = os.path.join(base_upload_folder, safe_username_dir)
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as e:
        current_app.logger.error(f"Could not create user data path {path}: {e}")
        return None  # Indicate failure
    return path


def get_user_analysis_path(username, analysis_id):
    """Returns the path to a specific analysis directory for a user."""
    user_data_path = get_user_specific_data_path(username)
    if not user_data_path:
        return None
    analysis_base_dir_name = "analyses"  # Name of the subfolder for all analyses
    analysis_path = os.path.join(
        user_data_path, analysis_base_dir_name, secure_filename(analysis_id)
    )
    try:
        os.makedirs(analysis_path, exist_ok=True)  # Create if it doesn't exist
    except OSError as e:
        current_app.logger.error(f"Could not create analysis path {analysis_path}: {e}")
        return None
    return analysis_path


def allowed_file(filename):
    return (
            "." in filename
            and filename.rsplit(".", 1)[1].lower()
            in current_app.config["ALLOWED_EXTENSIONS"]
    )


def estimate_fdr_for_gene(p_values_df, gene_name, p_value_cutoff):
    if gene_name not in p_values_df.columns:
        return np.nan

    p_gene = p_values_df[[gene_name]].dropna()
    m = p_gene.shape[0]  # Total tests for this gene
    if m == 0:
        return np.nan

    discoveries = (p_gene < p_value_cutoff).sum().iloc[0]

    if discoveries > 0:
        fdr = (p_value_cutoff * m) / discoveries
        return fdr
    else:
        return np.nan  # Or 0.0 if you prefer


def generate_scatter_plot_response(analysis_to_view, plot_type=None):
    try:
        layout_filepath = (analysis_to_view.get("inputs", {}).get("layout", {}).get("layout_filepath", ""))

        if not os.path.exists(layout_filepath):
            current_app.logger.error(f"Layout file '{layout_filepath}' not found!")
            return jsonify({"error": "Layout file not found."}), 404

        plot_columns = get_plot_axis_columns(plot_type)
        if not plot_columns:
            return jsonify({"error": "Invalid plot type specified."}), 400
        x_col, y_col, plot_title = plot_columns

        plot_df = read_layout_columns(layout_filepath, [x_col, y_col, CLUSTER_COL])
        traces, _, _, _ = generate_colored_traces(plot_df, plot_type=plot_type)

        layout = {
            "title": plot_title,
            "xaxis": {"title": x_col},
            "yaxis": {"title": y_col},
        }

        graph_data = {
            "data": traces,
            "layout": layout,
            "metadata_cols": analysis_to_view.get("metadata_cols", []),
            "tfs": analysis_to_view.get("tfs", [])
        }
        return jsonify(graph_data), 200

    except Exception as e:
        current_app.logger.error(
            f"Unexpected error for analysis_id '{analysis_to_view['id']}': {e}",
            exc_info=True,
        )
        return jsonify({"error": "An unexpected error occurred while preparing the plot."}), 500


def get_layout_and_metadata_dfs(analysis, user_id, plot_type="umap_plot"):
    layout_filepath = analysis.get("inputs").get("layout").get("layout_filepath")
    plot_columns = get_plot_axis_columns(plot_type)
    if not plot_columns:
        raise ValueError(f"Unknown plot type: {plot_type}")
    x_col, y_col, _ = plot_columns
    plot_df = _with_string_index(read_layout_columns(layout_filepath, [x_col, y_col]))

    metadata_df = get_analysis_metadata_df(analysis, user_id)
    return plot_df, metadata_df


def get_layout_and_gene_exp_levels_df(analysis, gene_name, plot_type="umap_plot"):
    try:
        layout_filepath = (analysis.get("inputs").get("layout").get("layout_filepath"))
        z_score_filepath = analysis.get("z_scores_path", "")
        plot_columns = get_plot_axis_columns(plot_type)
        if not plot_columns:
            return jsonify({"error": f"Unknown plot type: {plot_type}"}), 400
        x_col, y_col, _ = plot_columns

        if not os.path.exists(layout_filepath):
            current_app.logger.error(f"Layout file '{layout_filepath}' not found for analysis_id '{analysis['id']}'.")
            return jsonify({"error": "Layout file not found. Delete this analysis and create new analysis"}), 404

        if not os.path.exists(z_score_filepath):
            current_app.logger.error(f"Z-scores file '{z_score_filepath}' not found.")
            return jsonify({"error": "Z-scores file not found. Delete this analysis and create new analysis"}), 404

        plot_df = read_layout_columns(layout_filepath, [x_col, y_col])
        gene_exp_levels_df = pd.read_parquet(z_score_filepath, use_threads=True, columns=[gene_name])

        plot_df = plot_df.join(gene_exp_levels_df, how="inner")
        plot_df = plot_df.dropna(subset=[gene_name])

        return plot_df
    except Exception as e:
        current_app.logger.error(f"Error reading layout/z-score file for analysis_id '{analysis['id']}': {e}")
        return jsonify({"error": "Failed to read layout/z-score file. Invalid format."}), 500


def generate_colored_traces(
        plot_df, plot_type="umap_plot", cluster_col="Cluster", tf_activity=None
):
    plot_columns = get_plot_axis_columns(plot_type)
    if not plot_columns:
        current_app.logger.warning(f"Unknown plot type '{plot_type}'")
        return jsonify({"error": f"Unknown plot type: {plot_type}"}), 400
    x_col, y_col, base_title = plot_columns
    title = f"{base_title} Colored by {cluster_col if not tf_activity else tf_activity}"

    traces = []
    if tf_activity:
        activity_labels = plot_df[tf_activity].replace(TF_ACTIVITY_LABELS).fillna("Not_Enough_Data")
        for cluster, color in TF_ACTIVITY_COLORS.items():
            traces.append(
                _make_scattergl_trace(
                    cluster,
                    plot_df.loc[activity_labels == cluster, [x_col, y_col]],
                    x_col,
                    y_col,
                    marker={"color": color},
                )
            )
    else:
        for cluster, group_df in plot_df.groupby(cluster_col, sort=False, observed=True, dropna=False):
            cluster_label = "Not_Enough_Data" if pd.isna(cluster) else cluster
            traces.append(_make_scattergl_trace(cluster_label, group_df, x_col, y_col))
    return traces, title, x_col, y_col
