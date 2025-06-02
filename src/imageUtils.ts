// imageUtils.ts - Utilities for image compression

/**
 * Compress an image data URL to a smaller size
 */
export function compressImage(dataUrl: string, quality: number = 0.7, maxWidth: number = 800): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Calculate new dimensions while maintaining aspect ratio
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      
      canvas.width = width;
      canvas.height = height;
      
      // Draw and compress
      ctx.drawImage(img, 0, 0, width, height);
      const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(compressedDataUrl);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Create a thumbnail from an image data URL
 */
export function createThumbnail(dataUrl: string, maxSize: number = 150): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }
      
      // Calculate thumbnail dimensions (square)
      const size = Math.min(img.width, img.height);
      const scale = maxSize / size;
      
      canvas.width = maxSize;
      canvas.height = maxSize;
      
      // Calculate crop position for center crop
      const sx = (img.width - size) / 2;
      const sy = (img.height - size) / 2;
      
      // Draw cropped and scaled image
      ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
      const thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.8);
      resolve(thumbnailDataUrl);
    };
    img.onerror = () => reject(new Error('Failed to load image for thumbnail'));
    img.src = dataUrl;
  });
}

/**
 * Generate a unique ID for interactions
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Format timestamp for display
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - timestamp;
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffMins < 1) {
    return 'Just now';
  } else if (diffMins < 60) {
    return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Truncate text to a maximum length
 */
export function truncateText(text: string, maxLength: number = 100): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}