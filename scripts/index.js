const form = document.getElementById("registrationForm");
const statusEl = document.getElementById("regStatus");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const data = Object.fromEntries(formData.entries());
  data.terms = formData.get("terms") === "on";

  statusEl.textContent = "Registering team...";
  statusEl.className = "status";

  try {
    const response = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      throw new Error(result.message || "Registration failed.");
    }

    statusEl.textContent = `Registration complete. Your Team ID: ${result.teamId}`;
    statusEl.className = "status ok";
    alert(`Team registered successfully.\nTeam ID: ${result.teamId}`);
    form.reset();
  } catch (error) {
    statusEl.textContent = error.message || "Something went wrong.";
    statusEl.className = "status err";
  }
});
