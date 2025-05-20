import mongoose from "mongoose";
import {
  category,
  districts,
  highestEducation,
  roles,
} from "../utils/arrays.js";

const UserSchema = new mongoose.Schema(
  {
    clerkId: {
      type: String,
      required: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        "Please enter a valid email address",
      ],
    },
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      validate: {
        validator: function (v) {
          return /^\d{10}$/.test(v);
        },
        message: "Phone number must be exactly 10 digits.",
      },
    },
    alternatePhoneNumber: {
      type: String,
      validate: {
        validator: function (v) {
          return (
            v === undefined || v === null || v === "" || /^\d{10}$/.test(v)
          );
        },
        message: "Alternate phone number must be exactly 10 digits.",
      },
      sparse: true,
    },
    fullName: {
      type: String,
      required: true,
      minlength: [3, "Full name must be at least 3 characters long"],
      maxlength: [40, "Full name must have less than 40 characters"],
    },
    careOf: {
      type: String,
      required: true,
      minlength: [
        3,
        "Father's or mother's name must be at least 3 characters.",
      ],
      maxlength: [
        40,
        "Father's or mother's name must have less than 40 characters",
      ],
    },
    dateOfBirth: {
      type: Date,
      required: true,
      validate: {
        validator: function (dob) {
          const today = new Date();
          let age = today.getFullYear() - dob.getFullYear();

          // Adjust if birthday hasn't occurred yet this year
          const hasBirthdayOccurred =
            today.getMonth() > dob.getMonth() ||
            (today.getMonth() === dob.getMonth() &&
              today.getDate() >= dob.getDate());

          if (!hasBirthdayOccurred) {
            age -= 1;
          }

          return age >= 18;
        },
        message: "Date of birth cannot be less than 18 years.",
      },
    },
    gender: { type: String, required: true, enum: ["Male", "Female"] },
    category: {
      type: String,
      required: true,
      enum: category,
    },
    address: {
      type: String,
      required: true,
      minlength: [8, "Provide full address"],
      maxlength: [100, "Address must have less than 100 characters"],
    },
    district: {
      type: String,
      required: true,
      enum: districts,
    },
    highestEducation: {
      type: String,
      required: true,
      enum: highestEducation,
    },
    collegeOrUniversityName: { type: String },
    previouslyAttempted: { type: String, required: true, enum: ["Yes", "No"] },
    currentlyEmployed: { type: String, required: true, enum: ["Yes", "No"] },
    avatar: { type: String },
    role: {
      type: String,
      enum: roles,
      default: "Student",
    },
  },
  {
    timestamps: true,
  }
);

// Define optimized indexes with no duplications
UserSchema.index({ fullName: "text", address: "text" });
UserSchema.index({ district: 1, category: 1 });
UserSchema.index({ role: 1, district: 1 });
UserSchema.index({ dateOfBirth: 1 });
UserSchema.index({ createdAt: -1 });

const User = mongoose.model("User", UserSchema);

export default User;
