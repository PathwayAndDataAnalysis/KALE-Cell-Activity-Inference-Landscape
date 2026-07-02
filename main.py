import os
import traceback

from flask import jsonify
from werkzeug.exceptions import HTTPException

from app import create_app

application = create_app()

# Global error handlers
@application.errorhandler(413)
def too_large(e):
    return jsonify(error="File too large"), 413

@application.errorhandler(500)
def internal_error(e):
    application.logger.error(f"Internal server error: {e}")
    application.logger.error(traceback.format_exc())
    return jsonify(error="Internal server error"), 500

@application.errorhandler(404)
def not_found(e):
    return jsonify(error="Resource not found"), 404

@application.errorhandler(Exception)
def handle_exception(e):
    if isinstance(e, HTTPException):
        return jsonify(error=e.description), e.code

    application.logger.error(f"Unhandled exception: {e}")
    application.logger.error(traceback.format_exc())
    return jsonify(error="An unexpected error occurred"), 500

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "").lower() in {"1", "true", "yes"}
    host = os.environ.get("FLASK_RUN_HOST", "127.0.0.1")
    port = int(os.environ.get("FLASK_RUN_PORT", os.environ.get("PORT", 5000)))
    application.run(host=host, port=port, debug=debug)
