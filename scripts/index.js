const form = document.getElementById("registrationForm");
const statusEl = document.getElementById("regStatus");
const daysEl = document.getElementById("days");
const hoursEl = document.getElementById("hours");
const minutesEl = document.getElementById("minutes");
const secondsEl = document.getElementById("seconds");

function updateCountdown() {
  if (!daysEl || !hoursEl || !minutesEl || !secondsEl) return;

  const target = new Date("2026-03-24T09:00:00+05:30").getTime();
  const now = Date.now();
  const diff = Math.max(0, target - now);

  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const seconds = Math.floor((diff / 1000) % 60);

  daysEl.textContent = String(days).padStart(2, "0");
  hoursEl.textContent = String(hours).padStart(2, "0");
  minutesEl.textContent = String(minutes).padStart(2, "0");
  secondsEl.textContent = String(seconds).padStart(2, "0");
}

updateCountdown();
setInterval(updateCountdown, 1000);

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
