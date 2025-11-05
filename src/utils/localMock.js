// Local development mocks - No external services required

const mockServices = {
  // Mock AWS S3 service for local development
  s3: {
    uploadToS3: async (imageBase64, contentType) => {
      console.log('🔧 [MOCK] S3 Upload:', { contentType, size: imageBase64.length });
      return {
        success: true,
        message: "Image uploaded successfully (MOCK)",
        data: {
          fileUrl: `http://localhost:3000/mock-uploads/mock-image-${Date.now()}.${contentType.split('/')[1]}`,
          contentType,
          size: imageBase64.length
        }
      };
    },

    uploadaudiovideeToS3: async (buffer, contentType, folder) => {
      console.log('🔧 [MOCK] S3 Media Upload:', { contentType, folder, size: buffer.length });
      return `http://localhost:3000/mock-uploads/${folder}/mock-media-${Date.now()}.${contentType.split('/')[1]}`;
    },

    uploadFileToS3: async (fileBase64, contentType) => {
      console.log('🔧 [MOCK] S3 File Upload:', { contentType, size: fileBase64.length });
      return {
        success: true,
        message: "File uploaded successfully (MOCK)",
        data: {
          fileUrl: `http://localhost:3000/mock-uploads/files/mock-file-${Date.now()}.${contentType.split('/')[1]}`,
          contentType,
          size: fileBase64.length
        }
      };
    }
  },

  // Mock email service for local development
  email: {
    sendEmail: async (data) => {
      console.log('🔧 [MOCK] Email sent:', data);
      return { success: true, message: "Email sent successfully (MOCK)" };
    },

    sendForgotPasswordEmail: async (data) => {
      console.log('🔧 [MOCK] Forgot password email sent:', data);
      return { success: true, message: "Forgot password email sent successfully (MOCK)" };
    }
  },

  // Mock notification service
  notification: {
    sendNotification: async (data) => {
      console.log('🔧 [MOCK] Notification sent:', data);
      return { success: true, message: "Notification sent successfully (MOCK)" };
    }
  }
};

module.exports = mockServices;
