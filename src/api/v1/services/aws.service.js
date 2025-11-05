const AWS = require("aws-sdk");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3"); // v3 import
const dotenv = require("dotenv");
const sharp = require("sharp");
const fileType = require('file-type');
const mockServices = require("../../../utils/localMock");
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'AWS_S3_ACCESS_KEY',
  'AWS_S3_KEY_SECRET',
  'AWS_S3_REGION',
  'AWS_BUCKET_NAME'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.warn('Warning: Missing AWS environment variables:', missingEnvVars.join(', '));
  console.warn('AWS S3 functionality will be disabled until these variables are set.');
}

// Only initialize AWS clients if all required variables are present
let s3, s3Client;

if (missingEnvVars.length === 0) {
  s3 = new AWS.S3({
    accessKeyId: process.env.AWS_S3_ACCESS_KEY,
    secretAccessKey: process.env.AWS_S3_KEY_SECRET,
    region: process.env.AWS_S3_REGION,
    maxRetries: 3,
    retryDelayOptions: { base: 200 },
  });

  s3Client = new S3Client({
    region: process.env.AWS_S3_REGION,
    credentials: {
      accessKeyId: process.env.AWS_S3_ACCESS_KEY,
      secretAccessKey: process.env.AWS_S3_KEY_SECRET,
    },
  });
}

// Function to upload an image to S3
const uploadToS3 = async (imageBase64, contentType) => {
  // Use mock service for local development
  if (process.env.NODE_ENV === 'DEVELOPMENT' && missingEnvVars.length > 0) {
    return await mockServices.s3.uploadToS3(imageBase64, contentType);
  }

  try {
    const buffer = Buffer.from(imageBase64, "base64");

    // Generate a unique file name
    const key = `${Date.now()}.jpg`; // Or use a more structured naming convention

    // Prepare the parameters for the S3 upload
    const params = {
      Bucket: process.env.AWS_BUCKET_NAME, // Bucket name from environment variable
      Key: key, // Unique file name
      Body: buffer, // File content
      ContentType: contentType, // Content type (image/png, image/jpeg, etc.)
    };

    // Perform the upload to S3 using the PutObjectCommand
    const command = new PutObjectCommand(params);
    const data = await s3Client.send(command);

    return {
      success: true,
      url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`,
    };
  } catch (error) {
    console.error("Error uploading to S3:", error);
    return { success: false, message: "Upload failed" };
  }
};

const s3SharpImageUpload = async (file) => {
  try {
    const buffer = Buffer.from(
      file.replace(/^data:image\/\w+;base64,/, ""),
      "base64"
    );

    // Get metadata to determine image format
    let metadata;
    try {
      metadata = await sharp(buffer).metadata();
      // console.log("Detected metadata:", metadata);
    } catch (err) {
      // console.warn("Unable to extract metadata, falling back to raw upload.");
      metadata = { format: "heic" }; // Fallback for HEIC/HEIF
    }

    // Handle HEIC/HEIF fallback
    if (metadata.format === "heic" || metadata.format === "heif") {
      // console.warn("HEIC/HEIF detected. Uploading raw HEIC file...");
      return await uploadToS3(buffer, "image/heic");
    }

    // Process supported formats
    const processedImage = await sharp(buffer)
      .resize(300)
      .png({ quality: 40 })
      .toBuffer();

    // Upload processed image
    return await uploadToS3(processedImage, "image/png");
  } catch (error) {
    // console.error("Error uploading image:", error);
    throw new Error("Image upload failed");
  }
};

// const uploadToS3 = async (buffer, contentType) => {
//   const params = {
//     Bucket: process.env.AWS_S3_BUCKET,
//     Body: buffer,
//     Key: `images/${Date.now()}.${contentType.split("/")[1]}`,
//     ContentType: contentType,
//   };

//   try {
//     const result = await s3.upload(params).promise();
//     // console.log("S3 Upload Result:", result);
//     return result.Key; // Ensure only the key is returned
//   } catch (error) {
//     console.error("Error uploading to S3:", error);
//     // throw new AppError("Failed to upload to S3",200);
//   }
// };
const s3SharpImageUploadArray = async (file) => {
  const buffer = Buffer.from(
    file.replace(/^data:image\/\w+;base64,/, ""),
    "base64"
  );
  const data = await sharp(buffer).resize(300).png({ quality: 40 }).toBuffer(); // Convert the sharp output to buffer
  const params = {
    Bucket: process.env.AWS_S3_BUCKET,
    Body: data,
    Key: Date.now() + ".png",
    ContentType: `image/png`,
    CreateBucketConfiguration: {
      LocationConstraint: process.env.AWS_S3_REGION,
    },
  };
  return await s3UploadArray(params);
};

const s3UploadArray = async (params) => {
  try {
    let result = await s3.upload(params).promise();
    return result.Key;
  } catch (e) {
    console.log("s3Upload error", e);
  }
};

// Upload to S3 function
const uploadaudiovideeToS3 = async (buffer, contentType, folder) => {
  // Use mock service for local development
  if (process.env.NODE_ENV === 'DEVELOPMENT' && missingEnvVars.length > 0) {
    return await mockServices.s3.uploadaudiovideeToS3(buffer, contentType, folder);
  }

  console.log("uploadToS3", buffer);
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Body: buffer,
    Key: `${folder}/${Date.now()}.${contentType.split("/")[1]}`,
    ContentType: contentType,
  };

  try {
    const result = await s3.upload(params).promise();
    return result.Location; // Returning the file URL
  } catch (error) {
    console.error("Error uploading to S3:", error);
    throw new Error("Upload to S3 failed");
  }
};

/**
 * Uploads any file (image, pdf, etc.) to S3.
 * @param {string} base64String - The file as a base64 string (with or without data: prefix).
 * @param {string} contentType - The MIME type, e.g., 'image/png', 'application/pdf'.
 * @returns {Promise<{success: boolean, url?: string, message?: string}>}
 */
const uploadFileToS3 = async (base64String, contentType) => {
  // Use mock service for local development
  if (process.env.NODE_ENV === 'DEVELOPMENT' && missingEnvVars.length > 0) {
    return await mockServices.s3.uploadFileToS3(base64String, contentType);
  }

  try {
    // Remove data URL prefix if present
    const base64Data = base64String.replace(/^data:.*;base64,/, "");
    const buffer = Buffer.from(base64Data, "base64");

    // Detect file type
    const type = await fileType.fromBuffer(buffer);
    if (!type) {
      throw new Error("Unable to detect file type");
    }
    const { mime: detectedContentType, ext: extension } = type;

    const key = `${Date.now()}.${extension}`;

    const params = {
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType || detectedContentType,
    };

    const command = new PutObjectCommand(params);
    await s3Client.send(command);

    return {
      success: true,
      url: `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_S3_REGION}.amazonaws.com/${key}`,
      contentType: contentType || detectedContentType,
      extension
    };
  } catch (error) {
    console.error("Error uploading to S3:", error);
    return { success: false, message: "Upload failed" };
  }
};

module.exports = {
  s3SharpImageUpload,
  s3SharpImageUploadArray,
  uploadToS3,
  uploadaudiovideeToS3,
  uploadFileToS3,
};
