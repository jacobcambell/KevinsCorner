
const sharp = require('sharp');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs').promises;

class ImageProcessor {
  constructor() {
    this.uploadDir = path.join(__dirname, '../public/uploads/products');
    this.ensureUploadDir();
  }

  async ensureUploadDir() {
    try {
      await fs.mkdir(this.uploadDir, { recursive: true });
    } catch (error) {
      console.error('Error creating upload directory:', error);
    }
  }

  // Process base64 image: remove EXIF, compress, and save
  async processBase64Image(base64Data, productId) {
    try {
      // Remove data URL prefix if present
      const base64Image = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
      
      // Convert base64 to buffer
      const imageBuffer = Buffer.from(base64Image, 'base64');
      
      // Generate unique filename
      const filename = `${productId}_${crypto.randomBytes(16).toString('hex')}.jpg`;
      const filepath = path.join(this.uploadDir, filename);
      
      // Process image with Sharp: remove EXIF, resize, and compress
      await sharp(imageBuffer)
        .resize(800, 600, { 
          fit: 'inside', // Maintain aspect ratio
          withoutEnlargement: true // Don't upscale small images
        })
        .jpeg({ 
          quality: 75, // Compress to 75% quality
          progressive: true,
          mozjpeg: true // Better compression
        })
        .withMetadata({}) // Remove all metadata including EXIF
        .toFile(filepath);
      
      // Return the relative URL for database storage
      return `/uploads/products/${filename}`;
    } catch (error) {
      console.error('Error processing image:', error);
      throw new Error('Failed to process image');
    }
  }

  // Process multiple images
  async processMultipleImages(base64Images, productId) {
    const imageUrls = [];
    
    for (let i = 0; i < base64Images.length; i++) {
      if (base64Images[i] && base64Images[i].trim()) {
        try {
          const imageUrl = await this.processBase64Image(base64Images[i], `${productId}_${i}`);
          imageUrls.push(imageUrl);
        } catch (error) {
          console.error(`Error processing image ${i}:`, error);
          // Continue with other images even if one fails
        }
      }
    }
    
    return imageUrls;
  }

  // Delete image file
  async deleteImage(imageUrl) {
    try {
      if (imageUrl && imageUrl.startsWith('/uploads/products/')) {
        const filename = path.basename(imageUrl);
        const filepath = path.join(this.uploadDir, filename);
        await fs.unlink(filepath);
      }
    } catch (error) {
      console.error('Error deleting image:', error);
    }
  }

  // Validate base64 image and resize if too large
  async validateAndResizeBase64Image(base64Data) {
    if (!base64Data || typeof base64Data !== 'string') {
      return null;
    }

    // Check if it's a valid base64 image
    const base64Regex = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/;
    if (!base64Regex.test(base64Data)) {
      return null;
    }

    try {
      // If image is very large, pre-resize it
      if (base64Data.length > 10000000) { // ~7.5MB in base64
        const base64Image = base64Data.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Buffer.from(base64Image, 'base64');
        
        // Resize to a smaller dimension first
        const resizedBuffer = await sharp(imageBuffer)
          .resize(1200, 1200, { 
            fit: 'inside',
            withoutEnlargement: true
          })
          .jpeg({ quality: 80 })
          .toBuffer();
        
        // Convert back to base64
        const resizedBase64 = `data:image/jpeg;base64,${resizedBuffer.toString('base64')}`;
        return resizedBase64;
      }
      
      return base64Data;
    } catch (error) {
      console.error('Error validating/resizing image:', error);
      return null;
    }
  }

  // Validate base64 image
  validateBase64Image(base64Data) {
    if (!base64Data || typeof base64Data !== 'string') {
      return false;
    }

    // Check if it's a valid base64 image
    const base64Regex = /^data:image\/(jpeg|jpg|png|gif|webp);base64,/;
    if (!base64Regex.test(base64Data)) {
      return false;
    }

    // Check size (limit to 15MB base64 since we now auto-resize)
    if (base64Data.length > 20000000) { // ~15MB in base64
      return false;
    }

    return true;
  }
}

module.exports = new ImageProcessor();
