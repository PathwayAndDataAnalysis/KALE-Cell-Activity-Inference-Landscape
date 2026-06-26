import os

import numpy as np
import pandas as pd
from anndata import AnnData
from flask import current_app
from scipy.sparse import csr_matrix, issparse
from scipy.special import ndtr
from scipy.stats import zscore
from sklearn.utils.sparsefuncs import mean_variance_axis, inplace_csr_row_scale

from app.benjamini_hotchberg import run_bh_correction_and_save_tfs


def load_prior_network(prior_path: str, weight_type: str = "Uniform") -> pd.DataFrame:
    sep = "\t" if prior_path.lower().endswith((".tsv", ".txt")) else ","
    priors = pd.read_csv(prior_path, sep=sep, usecols=[0, 1, 2])
    priors = priors.rename(
        columns={
            "Regulator": "source",
            "RegulatoryEffect": "interaction",
            "TargetGene": "target",
        }
    )

    required_cols = {"source", "interaction", "target"}
    if not required_cols.issubset(priors.columns):
        raise ValueError(
            f"Prior network must include columns {sorted(required_cols)}. Found: {list(priors.columns)}"
        )

    interaction_map = {
        "upregulates-expression": 1,
        "downregulates-expression": -1,
        "upregulates": 1,
        "downregulates": -1,
        "activation": 1,
        "activates": 1,
        "inhibition": -1,
        "inhibits": -1,
    }
    interaction = priors["interaction"]
    if interaction.dtype == "object":
        interaction = interaction.astype(str).str.lower().str.strip()
        mapped_interaction = interaction.map(interaction_map)
        interaction = mapped_interaction.where(mapped_interaction.notna(), interaction)
    interaction = pd.to_numeric(interaction, errors="coerce")
    interaction = np.sign(interaction)
    priors["interaction"] = pd.Series(interaction, index=priors.index).replace(0, np.nan)

    priors["source"] = priors["source"].astype(str).str.strip()
    priors["target"] = priors["target"].astype(str).str.strip()
    priors = priors.dropna(subset=["source", "interaction", "target"])
    priors = priors[
        (priors["source"] != "")
        & (priors["target"] != "")
        & (priors["source"].str.lower() != "nan")
        & (priors["target"].str.lower() != "nan")
    ].copy()

    priors["interaction"] = priors["interaction"].astype(int)
    if weight_type != "Uniform":
        raise ValueError(f"Unsupported z-aggregate weight type: {weight_type}")
    priors["weight"] = 1.0

    return priors[["source", "interaction", "target", "weight"]].drop_duplicates().reset_index(drop=True)


def run_z_aggregate(
    adata: AnnData, priors: pd.DataFrame, min_targets: int
) -> tuple[pd.DataFrame, pd.DataFrame]:
    X = adata.X

    if issparse(X):
        mean, var = mean_variance_axis(X, axis=0)
        mean = np.asarray(mean).ravel()
        var = np.asarray(var).ravel()
        std = np.sqrt(var)
    else:
        X = np.asarray(X, dtype=np.float64)
        mean = X.mean(axis=0)
        std = X.std(axis=0)

    std = np.asarray(std, dtype=np.float64).ravel()
    std = np.maximum(std, 1e-12)

    pri = priors.copy()

    # Keep only genes present in this dataset
    pri = pri[pri["target"].isin(adata.var_names)].copy()

    pri["interaction"] = pd.to_numeric(pri["interaction"], errors="raise")
    pri["weight"] = pd.to_numeric(pri["weight"], errors="raise")
    pri["signed_weight"] = pri["weight"] * pri["interaction"]
    pri = pri.groupby(["source", "target"], as_index=False)["signed_weight"].sum()

    # Count usable unique targets per TF after dataset intersection
    tf_counts = pri.groupby("source")["target"].nunique()
    valid_tfs = tf_counts[tf_counts >= min_targets].index.tolist()

    if len(valid_tfs) == 0:
        empty = pd.DataFrame(index=adata.obs_names)
        return empty, empty

    pri = pri[pri["source"].isin(valid_tfs)].copy()

    genes_cat = pd.Categorical(pri["target"], categories=adata.var_names)
    tfs_cat = pd.Categorical(pri["source"], categories=valid_tfs)

    row_ind = genes_cat.codes
    col_ind = tfs_cat.codes
    data_val = pri["signed_weight"].to_numpy(dtype=np.float64)

    W = csr_matrix(
        (data_val, (row_ind, col_ind)),
        shape=(len(adata.var_names), len(valid_tfs)),
        dtype=np.float64,
    )

    # Z-Score Calculation
    inv_std = (1.0 / std).astype(np.float64)
    W_scaled = W.copy()
    inplace_csr_row_scale(W_scaled, inv_std)

    term1 = X @ W_scaled
    if issparse(term1):
        term1 = term1.toarray()

    term2 = mean @ W_scaled
    if issparse(term2):
        term2 = term2.toarray()

    numerator = term1 - term2

    sum_sq_weights = np.asarray(W.power(2).sum(axis=0)).ravel()
    denominator = np.sqrt(np.maximum(sum_sq_weights, 1e-12))

    final_z = numerator / denominator

    abs_z = np.abs(final_z)
    p_values = 2 * ndtr(-abs_z)
    p_values = np.clip(p_values, 1e-300, 1.0)

    scores = -np.log(p_values) * np.sign(final_z)

    scores_df = pd.DataFrame(scores, index=adata.obs_names, columns=valid_tfs)
    pvalues_df = pd.DataFrame(p_values, index=adata.obs_names, columns=valid_tfs)

    scores_df = scores_df.astype(np.float64)
    pvalues_df = pvalues_df.astype(np.float64)

    return scores_df, pvalues_df


def run_z_aggregate_analysis(
    user_id,
    analysis_id,
    analysis_data,
    adata,
    ignore_zeros,
    update_analysis_status_fn,
):
    try:
        update_analysis_status_fn(user_id=user_id, analysis_id=analysis_id, status="Running z-aggregate")
        current_app.logger.info(
            "[Z_AGGREGATE] Running z-aggregate for user '%s', analysis '%s'.",
            user_id,
            analysis_id,
        )

        if adata is None or adata.n_obs == 0 or adata.n_vars == 0:
            raise ValueError("Input data is empty or invalid")

        result_path = analysis_data.get("results_path")
        if not result_path:
            raise ValueError("Analysis result path is missing")
        os.makedirs(result_path, exist_ok=True)

        X = adata.X.toarray() if issparse(adata.X) else np.asarray(adata.X).copy()
        z_mat = zscore(X, axis=0)
        z_mat = np.nan_to_num(z_mat, nan=0.0, posinf=0.0, neginf=0.0)
        z_df = pd.DataFrame(z_mat, index=adata.obs_names, columns=adata.var_names)
        z_scores_path = os.path.join(result_path, "z_scores.parquet")
        z_df.to_parquet(z_scores_path)

        prior_data = analysis_data.get("inputs", {}).get("prior_data", {})
        prior_data_path = prior_data.get("prior_data_filepath")
        if prior_data_path in (None, "Default"):
            script_dir = os.path.dirname(os.path.abspath(__file__))
            prior_data_path = os.path.join(script_dir, "..", "prior_data", "causalpath.tsv")
        min_targets = prior_data.get("min_number_of_targets", 3)

        priors = load_prior_network(prior_data_path, weight_type="Uniform")
        activity_scores_df, pvalues_df = run_z_aggregate(adata, priors, min_targets=min_targets)
        activity_scores_df.sort_index(axis=1, inplace=True)
        pvalues_df.sort_index(axis=1, inplace=True)

        p_values_path = os.path.join(result_path, "p_values.parquet")
        activity_scores_path = os.path.join(result_path, "activity_scores.parquet")
        pvalues_df.to_parquet(p_values_path)
        activity_scores_df.to_parquet(activity_scores_path)

        run_bh_correction_and_save_tfs(
            user_id=user_id,
            analysis_id=analysis_id,
            p_values_df=pvalues_df,
            update_analysis_status_fn=update_analysis_status_fn,
            p_values_path=p_values_path,
            activity_scores_path=activity_scores_path,
            z_scores_path=z_scores_path,
        )

        current_app.logger.info(
            "[Z_AGGREGATE] Completed z-aggregate for user '%s', analysis '%s'.",
            user_id,
            analysis_id,
        )

    except Exception as e:
        current_app.logger.error(
            "[Z_AGGREGATE] Error for user '%s', analysis '%s': %s",
            user_id,
            analysis_id,
            e,
            exc_info=True,
        )
        update_analysis_status_fn(user_id=user_id, analysis_id=analysis_id, status="Error in z-aggregate", error=str(e))
        raise
