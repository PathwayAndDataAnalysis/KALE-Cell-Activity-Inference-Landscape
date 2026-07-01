# KALE: Cell Activity Inference Landscape

KALE is a Flask web application for uploading single-cell expression datasets, generating or using 2D layouts, and estimating transcription factor activity with a Z-Aggregate workflow and prior regulatory networks.

## Prerequisites

- Python 3.12 or higher
- [uv](https://docs.astral.sh/uv/) for Python dependency management
- Node.js and npm for Tailwind CSS assets
- Git

If Python 3.12 is not already installed, uv can install it:

```bash
uv python install 3.12
```

## Setup

```bash
git clone <repository-url>
cd KALE-Cell-Activity-Inference-Landscape

# Install Python dependencies from pyproject.toml/uv.lock
uv sync

# Install frontend tooling and build the Tailwind CSS file used by Flask
npm install
npm run build:css
```

The Flask app stores local runtime data in `instance/` and uploaded user data in `user_uploads/`. These directories are created automatically when the app starts.

## Running The App

For development, run the CSS watcher in one terminal and Flask in another:

```bash
npm run watch:css
```

```bash
uv run main.py
```

Then open `http://localhost:5000`. The server is configured to bind to `0.0.0.0:5000`, so it can also be reached from other devices on the same network if your firewall allows it.

## Basic Workflow

1. Sign up or log in.
2. Upload input files from the dashboard and choose the correct file type for each upload.
3. Create an analysis by selecting expression data, a prior network, preprocessing settings, and either an uploaded layout or generated UMAP settings.
4. View completed analyses, recolor plots by metadata/gene expression/TF activity, adjust significance thresholds, and download TF activity results.

## Input Files

| Input | Supported formats | Upload file type | Required | Notes |
| :-- | :-- | :-- | :-- | :-- |
| AnnData object | `.h5ad` | Auto-detected as `h5ad File` | Required for Method 1 | Recommended all-in-one input. Expression comes from `X`; metadata comes from `obs`. |
| Gene expression matrix | `.csv`, `.tsv` | `Gene Expression` | Required for Method 2 | Cells must be rows, genes must be columns, and the first column is treated as the cell index. |
| Cell metadata | `.csv` | `Metadata` | Optional for Method 2 | The first column should contain cell IDs matching the expression matrix. |
| 2D layout | `.csv`, `.tsv` | `2D Layout` | Optional | Use when you already have coordinates and do not want KALE to generate UMAP coordinates. |
| Prior network | `.csv`, `.tsv` | `Prior Data` | Optional | Built-in priors are available if you do not upload a custom network. |

### Method 1: AnnData Object

Upload a `.h5ad` file and select **I have a .h5ad file** when creating the analysis. KALE reads expression values from the AnnData matrix and metadata columns from `adata.obs`.

Gene identifiers should already match the selected prior network where possible. If more than half of the AnnData variable names look like Ensembl IDs, KALE tries to convert them to symbols using, in order:

- an existing `gene_symbols`, `symbol`, `gene_name`, or `symbols` column in `adata.var`
- a `feature_name` fallback
- bundled human or mouse GENCODE mapping files

### Method 2: Separate Expression And Metadata Files

Upload the expression matrix as `Gene Expression`. The matrix should look like this:

```csv
cell_id,GeneA,GeneB,GeneC
cell_1,0,2,5
cell_2,3,0,1
```

Metadata is optional, but if provided it should use the same cell IDs:

```csv
cell_id,cell_type,condition
cell_1,T cell,control
cell_2,B cell,treated
```

When using separate files, choose the species in the analysis form. This is used for mitochondrial gene handling and Ensembl-to-symbol mapping. KALE does not currently perform mouse-to-human ortholog conversion, so custom data and prior networks should use compatible gene identifiers.

## Layout Files

If you upload a layout instead of generating UMAP coordinates, the first column should contain cell IDs and the file must include:

- `X_umap1`
- `X_umap2`
- `Cluster`

Include `X_pca1` and `X_pca2` as well if you want the PCA plot view to work with the uploaded layout.

Example:

```csv
,X_umap1,X_umap2,X_pca1,X_pca2,Cluster
cell_1,1.2,-0.4,0.8,1.1,0
cell_2,0.5,0.9,-0.3,0.2,1
```

Generated layouts are saved with this same style of indexed CSV at `user_uploads/<user>/analyses/<analysis-id>/umap_coordinates.csv`.

## Prior Networks

KALE includes four built-in prior networks:

- CausalPath
- CollecTRI
- Ensemble
- DoRothEA

Custom prior uploads should be CSV or TSV files with `source`, `interaction`, and `target` columns. KALE also accepts `Regulator`, `RegulatoryEffect`, and `TargetGene` and renames them internally.

`interaction` can be numeric (`1` for activation, `-1` for inhibition) or one of the supported text labels such as `upregulates-expression`, `downregulates-expression`, `activation`, or `inhibition`.

The available prior weight modes are:

- `Uniform`
- `Correlation`
- `Specificity`
- `NonzeroRate`
- `Existing`

Use `Existing` only when the prior file includes a usable `weight` column.

## Troubleshooting

- If styling is missing, run `npm run build:css` and restart Flask.
- If port 5000 is busy, stop the process using that port or change the port in `main.py`.
- If uploads fail, confirm that there is enough disk space for `user_uploads/`.
- If an analysis reports no overlapping genes, check that expression gene names and prior-network target names use the same identifier style.
