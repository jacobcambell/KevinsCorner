
const errorHandler = {
  // Database error handler
  handleDatabaseError: (err, operation, additionalInfo = {}) => {
    console.error(`Database error during ${operation}:`, err);
    console.error('Additional info:', additionalInfo);
    console.error('Stack trace:', err.stack);
    
    // Return standardized error response
    return {
      success: false,
      error: `Database error during ${operation}`,
      details: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    };
  },

  // Validation error handler
  handleValidationError: (field, value, requirement) => {
    const message = `Validation failed for ${field}: ${requirement}`;
    console.error(message, { field, value });
    
    return {
      success: false,
      error: message,
      field: field
    };
  },

  // Authentication error handler
  handleAuthError: (operation, userId = null) => {
    const message = `Authentication failed for ${operation}`;
    console.error(message, { userId, timestamp: new Date().toISOString() });
    
    return {
      success: false,
      error: message,
      redirect: '/auth/login'
    };
  },

  // File operation error handler
  handleFileError: (err, operation, filePath = null) => {
    console.error(`File error during ${operation}:`, err);
    if (filePath) {
      console.error('File path:', filePath);
    }
    
    return {
      success: false,
      error: `File operation failed: ${operation}`,
      details: process.env.NODE_ENV === 'development' ? err.message : 'File operation error'
    };
  },

  // API error handler
  handleApiError: (err, apiName, endpoint = null) => {
    console.error(`API error with ${apiName}:`, err);
    if (endpoint) {
      console.error('Endpoint:', endpoint);
    }
    
    return {
      success: false,
      error: `External API error: ${apiName}`,
      details: process.env.NODE_ENV === 'development' ? err.message : 'External service unavailable'
    };
  },

  // Express error middleware
  expressErrorHandler: (err, req, res, next) => {
    console.error('Express error:', err);
    console.error('Request URL:', req.url);
    console.error('Request method:', req.method);
    console.error('User ID:', req.session?.userId);
    console.error('Stack trace:', err.stack);

    // Set default error message
    let message = 'Internal Server Error';
    let statusCode = 500;

    // Handle specific error types
    if (err.name === 'ValidationError') {
      message = 'Validation Error';
      statusCode = 400;
    } else if (err.name === 'UnauthorizedError') {
      message = 'Unauthorized';
      statusCode = 401;
    } else if (err.name === 'NotFoundError') {
      message = 'Not Found';
      statusCode = 404;
    }

    // Send error response
    if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
      res.status(statusCode).json({
        success: false,
        error: message,
        details: process.env.NODE_ENV === 'development' ? err.message : undefined
      });
    } else {
      res.status(statusCode).render('pages/error', {
        error: message,
        details: process.env.NODE_ENV === 'development' ? err.message : undefined,
        user: req.session?.userId ? {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: req.session.isVendor || false
        } : null
      });
    }
  }
};

module.exports = errorHandler;
