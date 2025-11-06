import multer from 'multer';

// Configure storage: use memory to forward to S3-compatible storage
const storage = multer.memoryStorage();

// File filter for application uploads (resume + optional cover letter PDF)
const fileFilter = (req, file, cb) => {
  if (file.fieldname === 'coverLetter') {
    // Cover letter must be PDF only
    if (file.mimetype === 'application/pdf') {
      return cb(null, true);
    }
    return cb(new Error('Cover letter must be a PDF file.'), false);
  }

  // Resume: allow PDF, DOC, DOCX
  const allowedMimeTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ];
  if (allowedMimeTypes.includes(file.mimetype)) {
    return cb(null, true);
  }
  return cb(new Error('Only PDF, DOC, and DOCX files are allowed for resumes!'), false);
};

// Configure multer for resumes
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Single resume upload middleware (backward compatibility)
export const uploadResume = upload.single('resume');

// New: Upload both resume and optional PDF cover letter
export const uploadApplicationFiles = upload.fields([
  { name: 'resume', maxCount: 1 },
  { name: 'coverLetter', maxCount: 1 }
]);

// Error handling middleware for resume uploads
export const handleResumeUploadError = (error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'Resume file too large. Maximum size is 5MB.'
      });
    }
    return res.status(400).json({
      success: false,
      error: 'File upload error: ' + error.message
    });
  }
  
  if (error.message === 'Only PDF, DOC, and DOCX files are allowed for resumes!') {
    return res.status(400).json({
      success: false,
      error: 'Only PDF, DOC, and DOCX files are allowed for resumes!'
    });
  }
  if (error.message === 'Cover letter must be a PDF file.') {
    return res.status(400).json({
      success: false,
      error: 'Cover letter must be a PDF file.'
    });
  }
  
  next(error);
};

export default upload;
