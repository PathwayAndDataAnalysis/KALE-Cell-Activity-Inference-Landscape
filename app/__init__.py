import json
import os
import secrets
import tempfile

from filelock import FileLock
from flask import Flask, abort, current_app, request, session
from flask_login import LoginManager, UserMixin
from werkzeug.utils import secure_filename


# --- User Model ---
class User(UserMixin):
    def __init__(self, id_):
        self.id = id_


# --- Login Manager Setup ---
login_manager = LoginManager()
login_manager.login_view = "auth.login"  # BlueprintName.routeName
login_manager.login_message_category = "info"
login_manager.login_message = "Please log in to access this page."


# --- User Data Helpers (using current_app for context) ---
def get_users_file_path():
    return current_app.config["USERS_FILE"]


def get_users_lock_path():
    return f"{get_users_file_path()}.lock"


def get_upload_folder_root():
    return current_app.config["UPLOAD_FOLDER"]


def _load_all_users_data_unlocked():
    with open(get_users_file_path(), "r") as f:
        return json.load(f)


def _save_all_users_data_unlocked(users_data):
    users_file_path = get_users_file_path()
    users_dir = os.path.dirname(users_file_path)
    os.makedirs(users_dir, exist_ok=True)
    tmp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            "w", dir=users_dir, delete=False, encoding="utf-8"
        ) as tmp_file:
            tmp_path = tmp_file.name
            json.dump(users_data, tmp_file, indent=4)
            tmp_file.write("\n")
            tmp_file.flush()
            os.fsync(tmp_file.fileno())
        os.replace(tmp_path, users_file_path)
    except OSError:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        raise


def get_all_users_data():
    """Loads all users' data from the JSON file."""
    try:
        with FileLock(get_users_lock_path()):
            return _load_all_users_data_unlocked()
    except FileNotFoundError:
        return {}
    except json.JSONDecodeError as exc:
        current_app.logger.error(f"Error decoding JSON from {get_users_file_path()}")
        raise RuntimeError("User data store is corrupted; refusing to overwrite it.") from exc


def save_all_users_data(users_data):
    """Saves all users' data to the JSON file with a lock and atomic replace."""
    try:
        with FileLock(get_users_lock_path()):
            _save_all_users_data_unlocked(users_data)
    except IOError as e:
        current_app.logger.error(f"Error saving users to {get_users_file_path()}: {e}")


def update_all_users_data(mutator):
    """Runs a read-modify-write update to users.json under one file lock."""
    try:
        with FileLock(get_users_lock_path()):
            try:
                users_data = _load_all_users_data_unlocked()
            except FileNotFoundError:
                users_data = {}
            mutator(users_data)
            _save_all_users_data_unlocked(users_data)
    except json.JSONDecodeError as exc:
        current_app.logger.error(f"Error decoding JSON from {get_users_file_path()}")
        raise RuntimeError("User data store is corrupted; refusing to overwrite it.") from exc


def find_analysis_by_id(analyses, analysis_id):
    """Finds an analysis by its ID in a list of analyses."""
    return next((a for a in analyses if a.get("id") == analysis_id), None)


def get_file_path(filename, user_id=None):
    """
    Returns the full path to a file in the uploads folder.
    If user_id is provided, returns the path in the user's folder.
    Otherwise, returns the path in the global uploads folder.
    If the file does not exist, returns None.

    Returns:
        str or None: The full file path if the file exists, otherwise None.
    """
    if not filename:
        raise FileNotFoundError("No filename provided")

    upload_folder = os.path.abspath(get_upload_folder_root())
    if user_id:
        base_dir = os.path.abspath(os.path.join(upload_folder, secure_filename(user_id)))
    else:
        base_dir = upload_folder

    filename = str(filename)
    path = os.path.abspath(filename if os.path.isabs(filename) else os.path.join(base_dir, filename))

    try:
        if os.path.commonpath([base_dir, path]) != base_dir:
            raise FileNotFoundError(f"File {filename} is outside the allowed upload folder")
    except ValueError as exc:
        raise FileNotFoundError(f"File {filename} is outside the allowed upload folder") from exc

    if os.path.exists(path):
        return path
    else:
        raise FileNotFoundError(f"File {path} does not exist")


def _csrf_token():
    token = session.get("_csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["_csrf_token"] = token
    return token


@login_manager.user_loader
def load_user(user_id):
    """Flask-Login hook to load a user by ID."""
    users_data = get_all_users_data()
    if user_id in users_data:
        return User(user_id)
    return None


def create_app(test_config=None):
    # Create and configure the app
    # app = Flask(__name__, instance_relative_config=True) # App name is 'app'
    app = Flask(
        __name__,
        instance_relative_config=True,
        template_folder="../templates",
        static_folder="../static",
    )

    # --- Configuration ---
    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY")
        or os.environ.get("FLASK_SECRET_KEY")
        or "dev_secret_key_CHANGE_THIS_IN_PRODUCTION!",
        # USERS_FILE will be in the instance folder
        USERS_FILE=os.path.join(app.instance_path, "users.json"),
        # UPLOAD_FOLDER will be at the project root level, sibling to 'app' and 'main.py'
        UPLOAD_FOLDER=os.path.join(os.path.dirname(app.root_path), "user_uploads"),
        ALLOWED_EXTENSIONS={
            "h5ad",
            "txt",
            "csv",
            "tsv",
            "gz",
            "zip",
            "rds",
        },  # Added rds
        MAX_CONTENT_LENGTH=int(
            os.environ.get("MAX_CONTENT_LENGTH", 500 * 1024 * 1024 * 1024)
        ),
        CSRF_ENABLED=True,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("FLASK_COOKIE_SECURE", "").lower()
        in {"1", "true", "yes"},
    )

    if test_config is None:
        # Load the instance config, if it exists, when not testing
        # e.g., create tf-pred-webserver/instance/config.py for production secrets
        app.config.from_pyfile("config.py", silent=True)
    else:
        # Load the test config if passed in
        app.config.from_mapping(test_config)

    # Ensure the instance folder exists (for USERS_FILE, config.py)
    try:
        os.makedirs(app.instance_path, exist_ok=True)
    except OSError as e:
        app.logger.error(f"Could not create instance folder: {app.instance_path} - {e}")

    # Ensure UPLOAD_FOLDER exists
    upload_folder_path = app.config["UPLOAD_FOLDER"]
    if not os.path.exists(upload_folder_path):
        try:
            os.makedirs(upload_folder_path, exist_ok=True)
            app.logger.info(f"Upload folder created at {upload_folder_path}")
        except OSError as e:
            app.logger.error(
                f"Could not create upload folder: {upload_folder_path} - {e}"
            )

    # Initialize Flask extensions
    login_manager.init_app(app)

    @app.context_processor
    def inject_csrf_token():
        return {"csrf_token": _csrf_token}

    @app.before_request
    def protect_csrf():
        if (
            not app.config.get("CSRF_ENABLED", True)
            or request.method not in {"POST", "PUT", "PATCH", "DELETE"}
        ):
            return None

        sent_token = (
            request.form.get("csrf_token")
            or request.headers.get("X-CSRFToken")
            or request.headers.get("X-CSRF-Token")
        )
        session_token = session.get("_csrf_token", "")
        if not sent_token or not secrets.compare_digest(sent_token, session_token):
            current_app.logger.warning("Blocked request with missing or invalid CSRF token.")
            abort(400)
        return None

    # Register Blueprints
    from . import routes as app_routes  # Using an alias to avoid confusion

    # custom filter to get the basename of a file path
    app.jinja_env.filters['basename'] = os.path.basename

    app.register_blueprint(app_routes.auth_bp)
    app.register_blueprint(app_routes.main_bp)

    # Initialize users.json if it doesn't exist
    # This should be done within app context to access app.config and logger
    with app.app_context():
        users_fpath = get_users_file_path()
        if not os.path.exists(users_fpath):
            save_all_users_data({})  # Create an empty users file
            current_app.logger.info(f"Initialized empty users file at {users_fpath}")

    return app
