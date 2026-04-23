const API = "https://script.google.com/macros/s/AKfycbyCfhFfbgdQwfEhpqhWsdMPgB1OfQzkiCRbzLsU-2R4TJgvmmNLiAgGXbmIujKvAk_C/exec";

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