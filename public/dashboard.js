const API = "YOUR_APPS_SCRIPT_URL";

async function loadLeads() {
  const res = await fetch(API);
  const data = await res.json();

  if (!data.length) {
    document.getElementById("data").innerHTML = "No leads yet.";
    return;
  }

  let html = "<table><tr><th>Name</th><th>Email</th><th>Path</th><th>Status</th></tr>";

  data.forEach(l => {
    html += `<tr>
      <td>${l.name}</td>
      <td>${l.email}</td>
      <td>${l.path}</td>
      <td>${l.tag}</td>
    </tr>`;
  });

  html += "</table>";

  document.getElementById("data").innerHTML = html;
}

loadLeads();