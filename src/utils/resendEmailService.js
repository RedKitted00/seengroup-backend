import { Resend } from 'resend';
import { logger } from './logger.js';

// Initialize Resend lazily
let resend = null;

const getResend = () => {
  if (!resend) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }
    resend = new Resend(apiKey);
  }
  return resend;
};

// Email configuration
const getEmailConfig = () => ({
  companyName: process.env.COMPANY_NAME || 'Seen Group',
  contactEmail: process.env.CONTACT_EMAIL || 'info@seengrp.com',
  adminEmail: process.env.ADMIN_EMAIL || 'info@seengrp.com',
  frontendUrl: process.env.FRONTEND_URL || 'https://workflow-seengroup.vercel.app/',
  companyLogo: 'https://pub-8b25a422bd234ffab965d339ba7bc4aa.r2.dev/site-logo.png'
});

// Email templates
const emailTemplates = {
  // User confirmation email template
  userConfirmation: (applicationData) => {
    const { name, email, jobTitle, applicationId } = applicationData;
    const config = getEmailConfig();
    
    return {
      subject: `Application Confirmation - ${jobTitle}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">Thank you for applying to ${config.companyName} — we've received your application.</div>
          ${config.companyLogo ? `<div style=\"text-align:center;margin-bottom:8px\"><img src=\"${config.companyLogo}\" alt=\"${config.companyName}\" style=\"height:36px\"/></div>` : ''}
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Application Received!</h1>
            <p style="color: white; margin: 10px 0 0 0; font-size: 16px;">Thank you for your interest in joining our team</p>
          </div>
          
          <div style="background: #f8f9fa; padding: 30px; border-radius: 0 0 10px 10px;">
            <h2 style="color: #333; margin-top: 0;">Hello ${name},</h2>
            
            <p style="color: #666; line-height: 1.6; font-size: 16px;">
              We have successfully received your application for the <strong>${jobTitle}</strong> position. 
              Your application ID is: <code style="background: #e9ecef; padding: 2px 6px; border-radius: 4px;">${applicationId}</code>
            </p>
            
            <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #667eea;">
              <h3 style="color: #333; margin-top: 0;">What happens next?</h3>
              <ul style="color: #666; line-height: 1.8;">
                <li>Our HR team will review your application within 2-3 business days</li>
                <li>If selected, we'll contact you to schedule an interview</li>
                <li>You'll receive updates on your application status via email</li>
              </ul>
            </div>
            
            <p style="color: #666; line-height: 1.6; font-size: 16px;">
              If you have any questions about your application, please don't hesitate to contact us.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="mailto:${config.contactEmail}" style="background: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                Contact Us
              </a>
            </div>
            
            <hr style="border: none; border-top: 1px solid #dee2e6; margin: 30px 0;">
            
            <p style="color: #999; font-size: 14px; text-align: center; margin: 0;">
              Best regards,<br>
              <strong>${config.companyName} HR Team</strong><br>
              <a href="mailto:${config.contactEmail}" style="color: #667eea;">${config.contactEmail}</a>
            </p>
          </div>
        </div>
      `,
      text: `
        Application Confirmation - ${jobTitle}
        
        Hello ${name},
        
        We have successfully received your application for the ${jobTitle} position.
        Your application ID is: ${applicationId}
        
        What happens next?
        - Our HR team will review your application within 2-3 business days
        - If selected, we'll contact you to schedule an interview
        - You'll receive updates on your application status via email
        
        If you have any questions about your application, please contact us at ${config.contactEmail}
        
        Best regards,
        ${config.companyName} HR Team
      `
    };
  },

  // Admin notification email template
  adminNotification: (applicationData) => {
    const { name, email, phone, jobTitle, applicationId, resumeUrl, coverLetter } = applicationData;
    const config = getEmailConfig();
    
    return {
      subject: `New Job Application: ${jobTitle} - ${name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; padding: 20px;">
          <div style="display:none;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden">New application for ${jobTitle} — quick links to download resume and cover letter inside.</div>
          ${config.companyLogo ? `<div style=\"text-align:center;margin-bottom:8px\"><img src=\"${config.companyLogo}\" alt=\"${config.companyName}\" style=\"height:36px\"/></div>` : ''}
          <div style="background: linear-gradient(135deg, #1f2937, #111827); padding: 24px; border-radius: 14px 14px 0 0; color: #fff;">
            <h1 style="margin: 0; font-size: 22px;">New Job Application</h1>
            <p style="margin: 6px 0 0; opacity: .85;">${jobTitle}</p>
          </div>
          <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 14px 14px;">
            <table style="width:100%; border-collapse: collapse; font-size:14px;">
              <tr>
                <td style="padding:8px 0; color:#374151; font-weight:600; width:140px;">Applicant</td>
                <td style="padding:8px 0; color:#4b5563;">${name}</td>
              </tr>
              <tr>
                <td style="padding:8px 0; color:#374151; font-weight:600;">Email</td>
                <td style="padding:8px 0; color:#4b5563;"><a href="mailto:${email}" style="color:#2563eb; text-decoration:none;">${email}</a></td>
              </tr>
              <tr>
                <td style="padding:8px 0; color:#374151; font-weight:600;">Phone</td>
                <td style="padding:8px 0; color:#4b5563;">${phone || 'Not provided'}</td>
              </tr>
              <tr>
                <td style="padding:8px 0; color:#374151; font-weight:600;">Application ID</td>
                <td style="padding:8px 0; color:#4b5563; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">${applicationId}</td>
              </tr>
            </table>

            <div style="margin:16px 0; height:1px; background:#e5e7eb;"></div>

            <div style="display:flex; gap:12px; flex-wrap:wrap;">
              ${resumeUrl ? `<a href="${resumeUrl}" style="background:#059669; color:#fff; padding:10px 14px; border-radius:8px; text-decoration:none; font-weight:600;">Download Resume</a>` : `<span style="background:#F3F4F6; color:#6B7280; padding:10px 14px; border-radius:8px;">No resume uploaded</span>`}
              ${coverLetter && /^https?:\/\//.test(coverLetter) ? `<a href="${coverLetter}" style="background:#2563eb; color:#fff; padding:10px 14px; border-radius:8px; text-decoration:none; font-weight:600;">Download Cover Letter</a>` : `<span style="background:#F3F4F6; color:#6B7280; padding:10px 14px; border-radius:8px;">No cover letter uploaded</span>`}
            </div>

            <div style="margin-top:20px; padding:16px; background:#fff; border:1px solid #e5e7eb; border-radius:10px;">
              <p style="margin:0; color:#6b7280;">Open the admin panel to review and take action.</p>
              <div style="margin-top:12px;">
                <a href="${config.frontendUrl}/admin/career" style="background:#111827; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">Open Admin Panel</a>
                <a href="mailto:${email}" style="margin-left:8px; background:#4f46e5; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none; font-weight:600;">Reply to Applicant</a>
              </div>
            </div>

            <p style="margin-top:16px; color:#9ca3af; font-size:12px; text-align:center;">This is an automated notification from ${config.companyName} career portal.</p>
          </div>
        </div>
      `,
      text: `
        New Job Application: ${jobTitle} - ${name}
        
        Application Details:
        - Name: ${name}
        - Email: ${email}
        - Phone: ${phone || 'Not provided'}
        - Position: ${jobTitle}
        - Application ID: ${applicationId}
        - Resume: ${resumeUrl ? 'Available for download' : 'No resume uploaded'}
        - Cover Letter: ${coverLetter && /^https?:\/\//.test(coverLetter) ? 'Available for download' : 'No cover letter uploaded'}
        
        View in Admin Panel: ${config.frontendUrl}/admin/career
        Reply to Applicant: ${email}
      `
    };
  }
};

// Send email function
export const sendEmail = async (to, subject, html, text, options = {}) => {
  // Input validation
  if (!to || !subject || !html || !text) {
    logger.error('Missing required email parameters');
    return { success: false, error: 'Missing required email parameters' };
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(to)) {
    logger.error('Invalid email address:', to);
    return { success: false, error: 'Invalid email address' };
  }

  try {
    const resendClient = getResend();

    const isProduction = process.env.NODE_ENV === 'production';

    // Use configured sender in production; fall back to Resend's sandbox in development
    const fromEmail = isProduction
      ? (process.env.FROM_EMAIL || 'onboarding@resend.dev')
      : 'onboarding@resend.dev';

    // Determine Reply-To (team inbox by default)
    const defaultReplyTo = process.env.REPLY_TO_EMAIL
      || process.env.CONTACT_EMAIL
      || process.env.ADMIN_EMAIL
      || process.env.FROM_EMAIL
      || 'info@seengrp.com';
    const replyTo = options.replyTo || defaultReplyTo;

    // In non-production, redirect outbound emails to a safe inbox to avoid spamming real users
    let actualRecipient = to;
    if (!isProduction) {
      const safeInbox = process.env.DEV_EMAIL_REDIRECT || process.env.ADMIN_EMAIL || 'info@seengrp.com';
      if (safeInbox) {
        actualRecipient = safeInbox;
        // Indicate original recipient inside content
        html = html.replace(/Hello [^,]+/, `Hello ${to.split('@')[0]} (Original: ${to})`);
        text = text.replace(/Hello [^,]+/, `Hello ${to.split('@')[0]} (Original: ${to})`);
      }
    }
    
    // Prepare CC/BCC safely (drop in non-production to avoid leaks)
    const cc = isProduction ? options.cc : undefined;
    const bcc = isProduction ? options.bcc : undefined;

    const { data, error } = await resendClient.emails.send({
      from: `${process.env.COMPANY_NAME || 'Seen Group'} <${fromEmail}>`,
      to: [actualRecipient],
      subject: subject,
      html: html,
      text: text,
      reply_to: replyTo,
      cc: Array.isArray(cc) ? cc : (cc ? [cc] : undefined),
      bcc: Array.isArray(bcc) ? bcc : (bcc ? [bcc] : undefined),
      headers: options.headers
    });

    if (error) {
      logger.error('Resend email error:', error);
      
      // Handle Resend domain verification error gracefully
      if (error.message && (error.message.includes('verify a domain') || error.message.includes('domain is not verified'))) {
        return { 
          success: false, 
          error: `Email service requires domain verification. Please verify your domain (${fromEmail.split('@')[1]}) in Resend dashboard at https://resend.com/domains`,
          code: 'DOMAIN_VERIFICATION_REQUIRED'
        };
      }
      
      return { success: false, error: error.message };
    }

    logger.info(`Email sent successfully to ${actualRecipient}${actualRecipient !== to ? ` (redirected from ${to})` : ''}:`, data);
    return { success: true, data };
  } catch (error) {
    logger.error('Email sending error:', error);
    return { success: false, error: error.message };
  }
};

// Send application confirmation email
export const sendApplicationConfirmation = async (applicationData) => {
  // Validate required data
  if (!applicationData || !applicationData.email || !applicationData.name || !applicationData.jobTitle) {
    logger.error('Missing required application data for confirmation email');
    return { success: false, error: 'Missing required application data' };
  }

  const template = emailTemplates.userConfirmation(applicationData);
  
  // Always send user confirmation to the applicant's email
  // In development, if the applicant email is not verified, we'll handle it in the sendEmail function
  const recipientEmail = applicationData.email;
  
  // Add test prefix only in non-production environments
  const isProduction = process.env.NODE_ENV === 'production';
  const subject = isProduction ? template.subject : `[TEST] ${template.subject}`;
  
  // Reply-To: team inbox so applicant replies go to HR
  return await sendEmail(recipientEmail, subject, template.html, template.text, {
    replyTo: process.env.REPLY_TO_EMAIL || process.env.CONTACT_EMAIL || process.env.ADMIN_EMAIL
  });
};

// Send admin notification email
export const sendAdminNotification = async (applicationData) => {
  // Validate required data
  if (!applicationData || !applicationData.name || !applicationData.email || !applicationData.jobTitle) {
    logger.error('Missing required application data for admin notification');
    return { success: false, error: 'Missing required application data' };
  }

  // Check if admin email is configured
  if (!process.env.ADMIN_EMAIL) {
    logger.error('Admin email not configured');
    return { success: false, error: 'Admin email not configured' };
  }

  const template = emailTemplates.adminNotification(applicationData);
  
  // Always send admin notification to the admin email
  // In development, if the admin email is not verified, we'll handle it in the sendEmail function
  const recipientEmail = process.env.ADMIN_EMAIL;
  
  // Always prefix admin notifications for clarity; add TEST in non-production
  const isProduction = process.env.NODE_ENV === 'production';
  const base = `[ADMIN] ${template.subject}`;
  const subject = isProduction ? base : `[TEST] ${base}`;
  
  // Reply-To: applicant's email so admin can reply directly
  return await sendEmail(recipientEmail, subject, template.html, template.text, {
    replyTo: applicationData.email
  });
};

