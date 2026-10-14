/* guide.js: search filter and print button for guide.html */
(function () {
  var input = document.getElementById('guideSearch');
  var sections = Array.prototype.slice.call(document.querySelectorAll('.g-section'));
  var none = document.getElementById('guideNone');
  var toc = document.getElementById('guideToc');

  function apply() {
    var q = input.value.trim().toLowerCase();
    var anyVisible = false;
    sections.forEach(function (sec) {
      var rows = Array.prototype.slice.call(sec.querySelectorAll('.g-row'));
      var visibleRows = 0;
      rows.forEach(function (row) {
        var match = !q || row.textContent.toLowerCase().indexOf(q) !== -1;
        row.hidden = !match;
        if (match) visibleRows++;
      });
      var textMatch = !q || sec.textContent.toLowerCase().indexOf(q) !== -1;
      var show = rows.length ? visibleRows > 0 : textMatch;
      sec.classList.toggle('g-empty', !show);
      if (show) anyVisible = true;
    });
    none.classList.toggle('show', !anyVisible);
    toc.style.display = q ? 'none' : '';
  }

  input.addEventListener('input', apply);
  document.getElementById('guidePrint').addEventListener('click', function () { window.print(); });
})();
