
async function main() {
  let res = await fetch("./update.json");
  let json = await res.json();

  let update = json.addons["{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}"].updates?.[0];

  document.getElementById("version").textContent = update.version;
  document.getElementById("min-version").textContent = update.applications.gecko.strict_min_version;
  document.getElementById("max-version").textContent = update.applications.gecko.strict_max_version;

  document.getElementById("download-btn").href = update.update_link;
}

async function download() {
  if (!navigator.userAgent.toLowerCase().includes('firefox')) {
   document.getElementById("download-warning").remove();
    return;
  }

  document.getElementById("download-btn").addEventListener("click", (event) => {
    if (event.button == 0) {
      event.preventDefault();
      document.getElementById("download-warning").classList.add("active");
    }
  });
  document.getElementById("download-warning").addEventListener("transitionend", (event) => {
    setTimeout(() => {
      document.getElementById("download-warning").classList.remove("active");
    }, 500);
  });
}

main();
download();
