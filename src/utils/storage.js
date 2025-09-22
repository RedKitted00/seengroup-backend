import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { lookup as lookupMime } from 'mime-types';

// S3-compatible storage client
const s3Client = new S3Client({
  region: process.env.S3_REGION || 'auto',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE).toLowerCase() === 'true',
  credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY ? {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
  } : undefined
});

const bucketName = process.env.S3_BUCKET;

export async function uploadBufferToS3(params) {
  const { buffer, originalName, mimetype, prefix = 'uploads' } = params;

  if (!bucketName) {
    throw new Error('S3_BUCKET is not configured');
  }

  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1e9);
  const safeName = (originalName || 'file').replace(/[^\w.\-]/g, '_');
  const key = `${prefix}/${timestamp}-${random}-${safeName}`;

  const contentType = mimetype || (lookupMime(originalName || '') || 'application/octet-stream');

  const putObjectParams = {
    Bucket: bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType
  };

  // R2 does not support ACLs; only include ACL for providers that need/allow it
  const endpointHost = String(process.env.S3_ENDPOINT || '').toLowerCase();
  const isR2 = endpointHost.includes('r2.cloudflarestorage.com');
  const desiredAcl = process.env.S3_OBJECT_ACL || 'public-read';
  if (!isR2 && desiredAcl && desiredAcl !== 'none') {
    putObjectParams.ACL = desiredAcl;
  }

  await s3Client.send(new PutObjectCommand(putObjectParams));

  // Build public URL
  if (process.env.S3_PUBLIC_BASE_URL) {
    return {
      key,
      url: `${process.env.S3_PUBLIC_BASE_URL.replace(/\/$/, '')}/${key}`
    };
  }

  // Fallback URL formats for common providers
  if (process.env.S3_ENDPOINT && process.env.S3_FORCE_PATH_STYLE === 'true') {
    // Path-style: https://endpoint/bucket/key
    const base = process.env.S3_ENDPOINT.replace(/\/$/, '');
    return { key, url: `${base}/${bucketName}/${key}` };
  }

  // Virtual-hosted style: https://bucket.s3.region.amazonaws.com/key
  const region = process.env.S3_REGION || 'us-east-1';
  return { key, url: `https://${bucketName}.s3.${region}.amazonaws.com/${key}` };
}

export default {
  uploadBufferToS3
};


