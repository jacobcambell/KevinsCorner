
const timeUtils = {
  // Get current server timestamp in ISO format
  now: () => {
    return new Date().toISOString();
  },

  // Get current server timestamp as Unix timestamp
  nowUnix: () => {
    return Math.floor(Date.now() / 1000);
  },

  // Format server timestamp for display
  formatForDisplay: (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC'
    }) + ' UTC';
  },

  // Get relative time (e.g., "2 hours ago")
  getRelativeTime: (timestamp) => {
    const now = new Date();
    const then = new Date(timestamp);
    const diffMs = now - then;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    
    return then.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  },

  // Validate timestamp format
  isValidTimestamp: (timestamp) => {
    const date = new Date(timestamp);
    return date instanceof Date && !isNaN(date);
  }
};

module.exports = timeUtils;
