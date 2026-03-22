function normalizeOutput(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function scoreCodingSubmission(round, answers) {
  const answerMap = new Map(
    (Array.isArray(answers) ? answers : []).map((item) => [
      String(item.caseId || "").trim(),
      normalizeOutput(item.output)
    ])
  );

  const evaluatedCases = (round.testCases || []).map((testCase) => {
    const submittedOutput = answerMap.get(testCase.caseId) || "";
    const expectedOutput = normalizeOutput(testCase.expectedOutput);
    const isCorrect = submittedOutput === expectedOutput;
    const points = isCorrect ? Number(testCase.points || 0) : 0;

    return {
      caseId: testCase.caseId,
      label: testCase.label,
      input: testCase.input,
      submittedOutput,
      expectedOutput,
      isCorrect,
      points
    };
  });

  return {
    evaluatedCases,
    correctCount: evaluatedCases.filter((item) => item.isCorrect).length,
    totalCases: evaluatedCases.length,
    totalPoints: evaluatedCases.reduce((sum, item) => sum + item.points, 0)
  };
}

function buildCodingLeaderboardRows(submissions) {
  return (submissions || []).map((row, index) => ({
    rank: index + 1,
    teamId: row.teamId,
    teamName: row.teamName || row.teamId,
    points: Number(row.totalPoints || 0),
    correctCount: Number(row.correctCount || 0),
    totalCases: Number(row.totalCases || 0),
    elapsedMs: Number(row.elapsedMs || 0)
  }));
}

module.exports = {
  normalizeOutput,
  scoreCodingSubmission,
  buildCodingLeaderboardRows
};
