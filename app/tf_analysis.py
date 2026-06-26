from app.run_z_aggregate import run_z_aggregate_analysis


def run_tf_analysis(
    user_id,
    analysis_id,
    analysis_data,
    adata,
    analysis_method=None,
    ignore_zeros=False,
    update_analysis_status_fn=None,
):
    """Compatibility wrapper for older imports; z-aggregate is now the only method."""
    return run_z_aggregate_analysis(
        user_id=user_id,
        analysis_id=analysis_id,
        analysis_data=analysis_data,
        adata=adata,
        ignore_zeros=ignore_zeros,
        update_analysis_status_fn=update_analysis_status_fn,
    )
