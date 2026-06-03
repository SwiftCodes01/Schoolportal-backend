import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();
const app = express();
const prisma = new PrismaClient();

app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
app.use(express.json());

// Sample Auth Route
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.passwordHash !== password) { // Use bcrypt.compare in production
      return res.status(401).json({ error: "Invalid credentials" });
    }
    // Generate JWT Token
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role, token: "JWT_GENERATED_TOKEN" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// server/src/routes/result.routes.ts
import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateJWT, checkRole } from "../middleware/auth";

const router = Router();
const prisma = new PrismaClient();

// 1. Enter/Save Scores (Teacher only)
router.post("/save", authenticateJWT, checkRole(["TEACHER"]), async (req, res) => {
  const { studentId, classId, subjectId, caScore, examScore, remark } = req.body;
  const currentSession = await prisma.session.findFirst({ where: { isCurrent: true } });
  const currentTerm = await prisma.term.findFirst({ where: { isCurrent: true } });

  if (!currentSession || !currentTerm) {
    return res.status(400).json({ error: "Active academic session or term not found." });
  }

  const totalScore = parseFloat(caScore) + parseFloat(examScore);
  
  // Grading logic
  let grade = "F";
  if (totalScore >= 70) grade = "A";
  else if (totalScore >= 60) grade = "B";
  else if (totalScore >= 50) grade = "C";
  else if (totalScore >= 45) grade = "D";
  else if (totalScore >= 40) grade = "E";

  try {
    const result = await prisma.result.upsert({
      where: {
        studentId_classId_subjectId_sessionId_termId: {
          studentId,
          classId,
          subjectId,
          sessionId: currentSession.id,
          termId: currentTerm.id
        }
      },
      update: { caScore, examScore, totalScore, grade, remark, submitted: false },
      create: {
        studentId,
        classId,
        subjectId,
        sessionId: currentSession.id,
        termId: currentTerm.id,
        caScore,
        examScore,
        totalScore,
        grade,
        remark,
        submitted: false
      }
    });

    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Submit Results to Admin for Approval (Teacher only)
router.post("/submit-class", authenticateJWT, checkRole(["TEACHER"]), async (req, res) => {
  const { classId, subjectId } = req.body;
  const currentSession = await prisma.session.findFirst({ where: { isCurrent: true } });
  const currentTerm = await prisma.term.findFirst({ where: { isCurrent: true } });

  try {
    await prisma.result.updateMany({
      where: {
        classId,
        subjectId,
        sessionId: currentSession.id,
        termId: currentTerm.id
      },
      data: { submitted: true }
    });
    res.json({ success: true, message: "Class results submitted to Admin for approval." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Approve and Publish Results (Admin only)
router.post("/approve-publish", authenticateJWT, checkRole(["ADMIN"]), async (req, res) => {
  const { classId, sessionId, termId } = req.body;

  try {
    const updated = await prisma.result.updateMany({
      where: { classId, sessionId, termId, submitted: true },
      data: { approved: true }
    });

    res.json({ success: true, message: `Successfully approved and published ${updated.count} records.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Calculate Class Rankings & Averages
export async function computeClassRankings(classId: string, sessionId: string, termId: string) {
  const students = await prisma.student.findMany({ where: { classId } });
  const rankings = [];

  for (const stud of students) {
    const results = await prisma.result.findMany({
      where: { studentId: stud.id, sessionId, termId, approved: true }
    });

    if (results.length === 0) continue;

    const total = results.reduce((sum, r) => sum + r.totalScore, 0);
    const avg = total / results.length;

    rankings.push({ studentId: stud.id, average: avg });
  }

  // Sort descending
  rankings.sort((a, b) => b.average - a.average);

  return rankings.map((r, idx) => ({
    studentId: r.studentId,
    average: r.average,
    position: idx + 1
  }));
}









const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 School portal server running on port ${PORT}`));