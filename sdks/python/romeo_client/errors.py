class RomeoApiError(Exception):
    def __init__(self, status_code, code, message, request_id=None, details=None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.request_id = request_id
        self.details = details or {}
