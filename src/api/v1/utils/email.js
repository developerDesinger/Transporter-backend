const sgMail = require("@sendgrid/mail");
require("dotenv").config(); // Load environment variables

// Set SendGrid API Key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const sendEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Validate OTP
  if (!options.otp) {
    console.error("❌ Error: No OTP provided.");
    return;
  }

  // Email Verification Template
  const htmlTemplate = `  
 <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Booking Bot Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px; text-align: center;">
    <p>Hello,</p>
    <p>Your One-Time Password (OTP) for verification is:</p>
    <p style="font-size: 24px; font-weight: bold; color: #50483f; margin: 10px 0;">${options.otp}</p>
    <p>Please enter this code to complete your verification process.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>If you did not request this OTP, please ignore this email.</p>
    <p>For any assistance, contact us at <a href="mailto:support@bookingbot.com" style="color: #007bff; text-decoration: none;">support@bookingbot.com</a>.</p>
    <p>Best regards,<br/>The Booking Bot Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: "tericalomnick@gmail.com", // Must be a verified sender email in SendGrid
    subject: options.subject || "Your OTP Code",
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(`✅ Email sent successfully to: ${options.email}`);
  } catch (error) {
    console.error(
      "❌ Error sending email:",
      error.response ? error.response.body : error
    );
  }
};

const sendForgotPasswordEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Validate OTP or Reset Token
  if (!options.otp) {
    console.error("❌ Error: No OTP provided.");
    return;
  }

  // Forgot Password Email Template
  const htmlTemplate = `  
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Booking Bot Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px; text-align: center;">
    <p>Hello,</p>
    <p>We received a request to reset your password. Use the OTP below to reset your password:</p>
    <p style="font-size: 24px; font-weight: bold; color: #50483f; margin: 10px 0;">${options.otp}</p>
    <p>If you did not request a password reset, you can ignore this email. Your password will remain unchanged.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>For any assistance, contact us at <a href="mailto:support@bookingbot.com" style="color: #007bff; text-decoration: none;">support@bookingbot.com</a>.</p>
    <p>Best regards,<br/>The Booking Bot Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: "tericalomnick@gmail.com", // Must be a verified sender email in SendGrid
    subject: options.subject || "Reset Your Password",
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(
      `✅ Forgot password email sent successfully to: ${options.email}`
    );
  } catch (error) {
    console.error(
      "❌ Error sending email:",
      error.response ? error.response.body : error
    );
  }
};

const sendDriverApplicationEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Validate induction link
  if (!options.inductionLink) {
    console.error("❌ Error: Induction link is missing.");
    return;
  }

  // Driver Application Email Template
  const htmlTemplate = `  
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Transporter.Digital Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px;">
    <p>Hello ${options.firstName || "there"},</p>
    <p>Thank you for your interest in joining Transporter.Digital!</p>
    <p>Your initial application has been received. To proceed, please complete your driver induction form.</p>
    <p style="text-align: center; margin: 30px 0;">
      <a href="${options.inductionLink}" style="background-color: #007bff; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Complete Your Induction Form</a>
    </p>
    <p><strong>This link will expire in 7 days.</strong></p>
    <p>If you didn't submit this application, please ignore this email.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>For any assistance, contact us at <a href="mailto:support@transporter.digital" style="color: #007bff; text-decoration: none;">support@transporter.digital</a>.</p>
    <p>Best regards,<br/>The Transporter.Digital Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: "tericalomnick@gmail.com", // Must be a verified sender email in SendGrid
    subject: options.subject || "Complete Your Driver Induction Form - Transporter.Digital",
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(`✅ Driver application email sent successfully to: ${options.email}`);
  } catch (error) {
    console.error(
      "❌ Error sending driver application email:",
      error.response ? error.response.body : error
    );
  }
};

const sendDriverInductionSubmittedEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Driver Induction Submitted Email Template
  const htmlTemplate = `  
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Transporter.Digital Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px;">
    <p>Hello ${options.fullName || "there"},</p>
    <p>Your driver induction form has been submitted successfully!</p>
    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
      <p><strong>Login Credentials:</strong></p>
      <p><strong>Username:</strong> ${options.username}</p>
      <p><strong>Password:</strong> changeme123</p>
    </div>
    <p style="text-align: center; margin: 30px 0;">
      <a href="${options.loginUrl || "http://localhost:5173/login"}" style="background-color: #007bff; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Log In</a>
    </p>
    <p><strong>Important:</strong> Please log in and change your password immediately after your application is approved.</p>
    <p>Your application is currently under review. We will notify you once it's approved.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>For any assistance, contact us at <a href="mailto:support@transporter.digital" style="color: #007bff; text-decoration: none;">support@transporter.digital</a>.</p>
    <p>Best regards,<br/>The Transporter.Digital Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: "tericalomnick@gmail.com", // Must be a verified sender email in SendGrid
    subject: options.subject || "Welcome to Transporter.Digital - Driver Induction Submitted",
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(`✅ Driver induction submitted email sent successfully to: ${options.email}`);
  } catch (error) {
    console.error(
      "❌ Error sending driver induction submitted email:",
      error.response ? error.response.body : error
    );
  }
};

const sendCustomerOnboardingEmail = async (options) => {
  // Validate recipient email
  if (!options.email) {
    console.error("❌ Error: Recipient email is missing.");
    return;
  }

  // Validate onboarding link
  if (!options.onboardingLink) {
    console.error("❌ Error: Onboarding link is missing.");
    return;
  }

  // Customer Onboarding Email Template
  const htmlTemplate = `  
  <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <img src="https://booking-bot-frontend.vercel.app/images/Group%201410088281.png" alt="Transporter.Digital Logo" style="max-width: 150px;">
  </div>
  <div style="background-color: #ffffff; padding: 20px;">
    <h2 style="color: #333; margin-bottom: 20px;">Welcome to Transporter Digital</h2>
    <p>Dear ${options.companyName || "Valued Customer"},</p>
    <p>Thank you for choosing our services. To complete your onboarding process, please click the link below:</p>
    <p style="text-align: center; margin: 30px 0;">
      <a href="${options.onboardingLink}" style="background-color: #007bff; color: #ffffff; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">Complete Onboarding Application</a>
    </p>
    <p><strong>This link will expire in 7 days.</strong></p>
    <p>If you did not request this link, please ignore this email.</p>
  </div>
  <div style="background-color: #f4f4f4; padding: 20px; text-align: center;">
    <p>For any assistance, contact us at <a href="mailto:support@transporter.digital" style="color: #007bff; text-decoration: none;">support@transporter.digital</a>.</p>
    <p>Best regards,<br/>The Transporter.Digital Team</p>
  </div>
</div>
`;

  // Email options
  const mailOptions = {
    to: options.email,
    from: process.env.FROM_EMAIL || "tericalomnick@gmail.com", // Use FROM_EMAIL from env or fallback
    subject: options.subject || `Complete Your Onboarding Application - ${options.companyName || "Transporter Digital"}`,
    html: htmlTemplate,
  };

  try {
    await sgMail.send(mailOptions);
    console.log(`✅ Customer onboarding email sent successfully to: ${options.email}`);
    return { success: true };
  } catch (error) {
    console.error(
      "❌ Error sending customer onboarding email:",
      error.response ? error.response.body : error
    );
    throw error;
  }
};

module.exports = { 
  sendEmail, 
  sendForgotPasswordEmail, 
  sendDriverApplicationEmail, 
  sendDriverInductionSubmittedEmail,
  sendCustomerOnboardingEmail 
};

// module.exports = sendEmail;
