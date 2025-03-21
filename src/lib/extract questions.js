import { PDFExtract } from "pdf.js-extract";

const pdfExtract = new PDFExtract();

export async function extractQuestionsFromPDF(filePath) {
  const options = {}; // Options for pdf.js-extract
  const data = await pdfExtract.extract(filePath, options);

  // Combine all text items into a single text string
  const text = data.pages
    .map((page) => page.content.map((item) => item.str).join(" "))
    .join("\n");

  // Regex patterns for questions and options
  const questionPattern = /(\d+)\.\s(.+?)(?=(\d+\.\s|$))/gs;
  const optionPattern = /([a-dA-D])\)\s*(.+?)(?=(\n[a-dA-D]\)|$))/gs;

  const questions = [];
  let match;

  while ((match = questionPattern.exec(text)) !== null) {
    const questionNumber = parseInt(match[1]);
    let questionText = match[2].trim();

    // Extract options from the question text
    const options = [];
    let optionMatch;
    while ((optionMatch = optionPattern.exec(questionText)) !== null) {
      options.push({
        option: optionMatch[1],
        text: optionMatch[2].trim(),
      });
    }

    // Remove options text from the question text
    questionText = questionText.replace(optionPattern, "").trim();

    // Store the structured question
    questions.push({
      question_number: questionNumber,
      question_text: questionText,
      options,
    });
  }

  return questions;
}
