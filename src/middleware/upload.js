import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure storage: use memory to forward to S3-compatible storage
const storage = multer.memoryStorage();

// File filter for images
const imageFileFilter = (req, file, cb) => {
  // Allow only images
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

// File filter for documents (PDFs)
const documentFileFilter = (req, file, cb) => {
  // Allow images and PDFs
  if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only image and PDF files are allowed!'), false);
  }
};

// Configure multer for images
const imageUpload = multer({
  storage: storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Configure multer for documents (images + PDFs)
const documentUpload = multer({
  storage: storage,
  fileFilter: documentFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for documents
  }
});

// Single file upload middleware for images
export const uploadSingle = imageUpload.single('image');

// Single file upload middleware for documents
export const uploadDocument = documentUpload.single('document');

// Multiple files upload middleware
export const uploadMultiple = imageUpload.array('images', 5); // Max 5 images

// Error handling middleware
export const handleUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large. Maximum size is 5MB.'
      });
    }
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files. Maximum is 5 files.'
      });
    }
    return res.status(400).json({
      success: false,
      error: 'File upload error: ' + error.message
    });
  }
  
  if (error.message === 'Only image files are allowed!' || error.message === 'Only image and PDF files are allowed!') {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }
  
  next(error);
};

export default imageUpload;
