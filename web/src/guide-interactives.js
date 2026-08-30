// Static, dependency-free component lab for guide.html.
// It mirrors important editor interactions without creating a PartyKit room.
(function () {
  'use strict';

  var lab = document.getElementById('component-lab');
  if (!lab) return;

  var lessons = {
    modes: {
      kicker: '01 · MODE SWITCH',
      title: '先理解四种模式',
      body: '点击顶部四个图标，观察画布、鼠标行为和右侧批注区如何变化。',
      steps: ['点“阅读”查看成品', '点“编辑”选择并修改模块', '点“拖拽”重排卡片', '点“批注”选择反馈对象'],
      action: '定位模式切换器',
      banner: '试一试：点击迷你编辑器顶部的四个模式图标。'
    },
    tools: {
      kicker: '02 · BLOCK TOOLS',
      title: '操作浮动工具栏',
      body: '在编辑模式选择卡片，使用真实形态的插入、复制、链接、样式和删除工具。',
      steps: ['点击任意内容卡片', '使用浮动工具栏操作', '用底部提示撤销删除或复制'],
      action: '选中示例卡片',
      banner: '试一试：选中卡片，再点击浮动工具栏中的复制、链接或样式。'
    },
    table: {
      kicker: '03 · TABLE CONTROLS',
      title: '直接操作表格行列',
      body: '表格上方和左侧的控制条对应列与行；编辑模式打开菜单，拖拽模式调整顺序。',
      steps: ['点控制条打开行列菜单', '使用右侧或底部 + 新增', '切到拖拽后拖动控制条'],
      action: '定位表格控制区',
      banner: '试一试：点击表格控制条打开菜单，或使用虚线 + 增加行列。'
    },
    comments: {
      kicker: '04 · COMMENTS',
      title: '选择元素并留下批注',
      body: '批注模式会打开右侧评论区；点击文档元素就能创建带定位信息的反馈。',
      steps: ['点击文档中的卡片', '输入一条具体修改意见', '保存后点击批注可回到元素'],
      action: '开始写一条批注',
      banner: '试一试：点击文档中的任意模块，输入批注并保存。'
    },
    share: {
      kicker: '05 · COLLABORATION',
      title: '理解分享与协作入口',
      body: '房间链接就是协作入口。复制后发给同事，双方会进入同一个可编辑文档。',
      steps: ['点击右上角“分享”', '复制示例房间链接', '观察协作者头像和状态栏'],
      action: '打开分享组件',
      banner: '试一试：打开“分享”，复制链接；这是邀请协作者的完整流程。'
    },
    export: {
      kicker: '06 · EXPORT',
      title: '选择正确的交付方式',
      body: '下载 HTML 用于发布；交给 AI 会把页面和批注整理成下一轮修改提示词。',
      steps: ['点击右上角“导出”', '选择 HTML 或 AI', '查看两种导出内容的差别'],
      action: '打开导出组件',
      banner: '试一试：打开“导出”，分别预览 HTML 与交给 AI 的内容。'
    }
  };

  var lessonIds = Object.keys(lessons);
  var storageKey = 'hce-guide-component-progress-v1';
  var completed = loadProgress();
  var activeLesson = 'modes';
  var mode = 'edit';
  var selectedBlock = null;
  var tableMode = 'edit';
  var tableMenuTarget = null;
  var draggedSegment = null;
  var draggedBlock = null;
  var undoAction = null;
  var toastTimer = null;

  var lessonTitle = document.getElementById('lab-lesson-title');
  var lessonBody = document.getElementById('lab-lesson-body');
  var lessonKicker = document.getElementById('lab-lesson-kicker');
  var lessonSteps = document.getElementById('lab-lesson-steps');
  var lessonAction = document.getElementById('lab-lesson-action');
  var stageBanner = document.getElementById('lab-stage-banner');
  var progressText = document.getElementById('lab-progress-text');
  var progressFill = document.getElementById('lab-progress-fill');
  var doc = document.getElementById('lab-doc');
  var canvas = document.getElementById('lab-canvas');
  var toolbar = document.getElementById('lab-floating-tools');
  var addMenu = document.getElementById('lab-add-menu');
  var styleMenu = document.getElementById('lab-style-menu');
  var sharePopover = document.getElementById('lab-share-popover');
  var exportPopover = document.getElementById('lab-export-popover');
  var commentRail = document.getElementById('lab-comment-rail');
  var commentComposer = document.getElementById('lab-comment-composer');
  var commentInput = document.getElementById('lab-comment-input');
  var commentTarget = document.getElementById('lab-comment-target');
  var commentList = document.getElementById('lab-comment-list');
  var commentCount = document.getElementById('lab-comment-count');
  var table = document.getElementById('lab-table');
  var tableFrame = document.getElementById('lab-table-frame');
  var colControls = document.getElementById('lab-col-controls');
  var rowControls = document.getElementById('lab-row-controls');
  var tableMenu = document.getElementById('lab-table-menu');
  var tableHint = document.getElementById('lab-table-hint');
  var exportPreview = document.getElementById('lab-export-preview');
  var exportPreviewTitle = document.getElementById('lab-export-preview-title');
  var exportPreviewText = document.getElementById('lab-export-preview-text');
  var toast = document.getElementById('lab-toast');
  var toastText = document.getElementById('lab-toast-text');
  var toastUndo = document.getElementById('lab-toast-undo');
  var statusMessage = document.getElementById('lab-status-message');
  var shareUrl = document.getElementById('lab-share-url');
  var shareCopy = document.getElementById('lab-share-copy');

  var comments = [{
    author: 'Mia',
    text: '标题可以再明确一点，突出协作价值。',
    ref: '一起完成更好的 HTML',
    target: 'hero'
  }];

  function loadProgress() {
    try {
      var value = JSON.parse(localStorage.getItem(storageKey) || '[]');
      return new Set(Array.isArray(value) ? value : []);
    } catch (error) {
      return new Set();
    }
  }

  function saveProgress() {
    try { localStorage.setItem(storageKey, JSON.stringify(Array.from(completed))); } catch (error) { /* storage is optional */ }
  }

  function completeLesson(id) {
    if (!lessons[id] || completed.has(id)) return;
    completed.add(id);
    saveProgress();
    updateProgress();
  }

  function updateProgress() {
    var count = completed.size;
    progressText.textContent = count + ' / ' + lessonIds.length;
    progressFill.style.width = (count / lessonIds.length * 100) + '%';
    lessonIds.forEach(function (id) {
      var button = lab.querySelector('.lab-lesson[data-lesson="' + id + '"]');
      if (button) button.classList.toggle('is-complete', completed.has(id));
    });
    if (count === lessonIds.length) {
      statusMessage.textContent = '组件练习已完成，可以进入真实文档继续操作';
    }
  }

  function selectLesson(id) {
    if (!lessons[id]) return;
    activeLesson = id;
    var item = lessons[id];
    lab.querySelectorAll('.lab-lesson').forEach(function (button) {
      button.setAttribute('aria-selected', String(button.dataset.lesson === id));
    });
    lessonKicker.textContent = item.kicker;
    lessonTitle.textContent = item.title;
    lessonBody.textContent = item.body;
    lessonSteps.replaceChildren();
    item.steps.forEach(function (step) {
      var li = document.createElement('li');
      li.textContent = step;
      lessonSteps.appendChild(li);
    });
    lessonAction.textContent = item.action;
    stageBanner.textContent = item.banner;
    prepareLesson(id);
  }

  function prepareLesson(id) {
    closeTopPopovers();
    closeInlineMenus();
    exportPreview.hidden = true;
    if (id === 'modes') {
      setMode(mode, false);
      flash(document.getElementById('lab-mode-switch'));
    } else if (id === 'tools') {
      setMode('edit', false);
      selectBlock(doc.querySelector('[data-demo-id="card-a"]'));
      flash(toolbar);
    } else if (id === 'table') {
      setMode('edit', false);
      flash(tableFrame);
    } else if (id === 'comments') {
      setMode('comment', false);
      selectCommentTarget(doc.querySelector('[data-demo-id="card-a"]'), false);
    } else if (id === 'share') {
      openSharePopover();
    } else if (id === 'export') {
      openExportPopover();
    }
  }

  function focusActiveLesson() {
    var id = activeLesson;
    if (id === 'modes') {
      flash(document.getElementById('lab-mode-switch'));
    } else if (id === 'tools') {
      setMode('edit', false);
      selectBlock(doc.querySelector('[data-demo-id="card-a"]') || doc.querySelector('.lab-selectable'));
      flash(toolbar);
    } else if (id === 'table') {
      setMode('edit', false);
      flash(tableFrame);
    } else if (id === 'comments') {
      setMode('comment', false);
      selectCommentTarget(doc.querySelector('[data-demo-id="card-a"]'), true);
    } else if (id === 'share') {
      openSharePopover();
      flash(sharePopover);
    } else if (id === 'export') {
      openExportPopover();
      flash(exportPopover);
    }
  }

  function flash(element) {
    if (!element) return;
    element.classList.remove('lab-flash');
    void element.offsetWidth;
    element.classList.add('lab-flash');
    window.setTimeout(function () { element.classList.remove('lab-flash'); }, 950);
  }

  function setMode(nextMode, meaningful) {
    mode = nextMode;
    doc.dataset.mode = nextMode;
    lab.querySelectorAll('.lab-mode-btn').forEach(function (button) {
      button.setAttribute('aria-selected', String(button.dataset.mode === nextMode));
    });
    doc.querySelectorAll('.lab-editable').forEach(function (element) {
      if (nextMode === 'edit') {
        element.setAttribute('contenteditable', 'true');
        element.setAttribute('spellcheck', 'false');
      } else {
        element.removeAttribute('contenteditable');
        element.removeAttribute('spellcheck');
      }
    });
    doc.querySelectorAll('.lab-reorderable').forEach(function (element) {
      element.draggable = nextMode === 'drag';
    });
    commentRail.classList.toggle('is-visible', nextMode === 'comment');
    if (nextMode !== 'comment') commentComposer.hidden = true;
    syncToolbar();
    if (nextMode === 'drag') setTableMode('drag');
    if (nextMode === 'edit') setTableMode('edit');
    var labels = {
      view: '阅读模式 · 预览最终效果',
      edit: '编辑模式 · 点击内容进行修改',
      drag: '拖拽模式 · 拖动卡片调整顺序',
      comment: '批注模式 · 点击元素留下反馈'
    };
    statusMessage.textContent = labels[nextMode] || '';
    if (meaningful !== false) completeLesson('modes');
  }

  function selectBlock(element) {
    doc.querySelectorAll('.lab-selectable.is-selected').forEach(function (item) {
      item.classList.remove('is-selected');
    });
    selectedBlock = element || null;
    closeInlineMenus();
    if (selectedBlock) {
      selectedBlock.classList.add('is-selected');
      selectedBlock.appendChild(toolbar);
    } else {
      canvas.appendChild(toolbar);
    }
    syncToolbar();
  }

  function syncToolbar() {
    toolbar.hidden = !(mode === 'edit' && selectedBlock && document.contains(selectedBlock));
  }

  function closeInlineMenus() {
    addMenu.hidden = true;
    styleMenu.hidden = true;
    tableMenu.hidden = true;
    lab.querySelectorAll('.lab-table-control.is-active').forEach(function (control) {
      control.classList.remove('is-active');
    });
  }

  function closeTopPopovers(except) {
    if (except !== sharePopover) sharePopover.hidden = true;
    if (except !== exportPopover) exportPopover.hidden = true;
    document.getElementById('lab-share-button').classList.toggle('is-active', except === sharePopover);
    document.getElementById('lab-export-button').classList.toggle('is-active', except === exportPopover);
  }

  function openSharePopover() {
    var url = location.origin + location.pathname.replace(/guide\.html$/, '') + 'room.html?room=demo-team';
    shareUrl.value = url;
    closeTopPopovers(sharePopover);
    sharePopover.hidden = false;
  }

  function openExportPopover() {
    closeTopPopovers(exportPopover);
    exportPopover.hidden = false;
  }

  function showToast(message, undo) {
    window.clearTimeout(toastTimer);
    toastText.textContent = message;
    undoAction = typeof undo === 'function' ? undo : null;
    toastUndo.hidden = !undoAction;
    toast.hidden = false;
    toastTimer = window.setTimeout(function () {
      toast.hidden = true;
      undoAction = null;
    }, 4200);
  }

  function runToolAction(action) {
    if (!selectedBlock || !document.contains(selectedBlock)) return;
    completeLesson('tools');
    if (action === 'add') {
      addMenu.hidden = !addMenu.hidden;
      styleMenu.hidden = true;
      return;
    }
    if (action === 'style') {
      styleMenu.hidden = !styleMenu.hidden;
      addMenu.hidden = true;
      return;
    }
    closeInlineMenus();
    if (action === 'duplicate') {
      var original = selectedBlock;
      var clone = original.cloneNode(true);
      var clonedToolbar = clone.querySelector('#lab-floating-tools');
      if (clonedToolbar) clonedToolbar.remove();
      clone.classList.remove('is-selected');
      clone.removeAttribute('data-demo-id');
      original.after(clone);
      setMode(mode, false);
      showToast('已复制一个模块', function () {
        clone.remove();
        selectBlock(original);
      });
    } else if (action === 'link') {
      selectedBlock.classList.toggle('is-linked');
      showToast(selectedBlock.classList.contains('is-linked') ? '已绑定整块跳转链接' : '已移除整块链接');
    } else if (action === 'delete') {
      var removed = selectedBlock;
      var parent = removed.parentNode;
      var next = removed.nextSibling;
      canvas.appendChild(toolbar);
      selectedBlock = null;
      removed.remove();
      syncToolbar();
      showToast('已删除模块', function () {
        parent.insertBefore(removed, next);
        selectBlock(removed);
      });
    }
  }

  function addDemoContent(kind) {
    addMenu.hidden = true;
    completeLesson('tools');
    if (kind === 'media') {
      var placeholder = document.createElement('div');
      placeholder.className = 'lab-media-placeholder lab-selectable lab-reorderable';
      placeholder.textContent = '图片 / 视频占位框 · 点击后可替换资源';
      selectedBlock.after(placeholder);
      setMode(mode, false);
      selectBlock(placeholder);
      showToast('已插入图片 / 视频模块', function () { placeholder.remove(); });
    } else if (kind === 'table') {
      flash(tableFrame);
      showToast('表格组件位于文档下方');
    }
  }

  function applyDemoStyle(style) {
    if (!selectedBlock) return;
    selectedBlock.classList.remove('is-styled', 'is-styled-warm');
    if (style === 'indigo') selectedBlock.classList.add('is-styled');
    if (style === 'warm') selectedBlock.classList.add('is-styled-warm');
    styleMenu.hidden = true;
    completeLesson('tools');
    showToast(style === 'default' ? '已恢复默认样式' : '已应用示例样式');
  }

  function setTableMode(nextMode) {
    tableMode = nextMode;
    lab.querySelectorAll('[data-table-mode]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.tableMode === nextMode));
    });
    document.getElementById('lab-add-col').hidden = nextMode !== 'edit';
    document.getElementById('lab-add-row').hidden = nextMode !== 'edit';
    tableHint.textContent = nextMode === 'edit'
      ? '点击灰色控制条打开插入、复制、删除菜单。'
      : '按住灰色控制条拖到另一条上，即可交换行列顺序。';
    renderTableControls();
    tableMenu.hidden = true;
  }

  function gripIcon(horizontal) {
    return horizontal
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="7" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="17" cy="12" r="1"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="17" r="1"/></svg>';
  }

  function renderTableControls() {
    var columnCount = table.rows[0] ? table.rows[0].cells.length : 0;
    var rowCount = table.rows.length;
    colControls.style.gridTemplateColumns = 'repeat(' + columnCount + ', minmax(0, 1fr))';
    rowControls.style.gridTemplateRows = 'repeat(' + rowCount + ', minmax(0, 1fr))';
    colControls.replaceChildren();
    rowControls.replaceChildren();
    for (var column = 0; column < columnCount; column++) {
      colControls.appendChild(makeTableControl('col', column, true));
    }
    for (var row = 0; row < rowCount; row++) {
      rowControls.appendChild(makeTableControl('row', row, false));
    }
  }

  function makeTableControl(kind, index, horizontal) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'lab-table-control';
    button.dataset.tableKind = kind;
    button.dataset.tableIndex = String(index);
    button.draggable = tableMode === 'drag';
    button.setAttribute('aria-label', (kind === 'col' ? '第 ' + (index + 1) + ' 列' : '第 ' + (index + 1) + ' 行') + (tableMode === 'drag' ? '，拖动排序' : '，打开菜单'));
    button.innerHTML = gripIcon(horizontal);
    return button;
  }

  function openTableMenu(control) {
    tableMenuTarget = {
      kind: control.dataset.tableKind,
      index: Number(control.dataset.tableIndex)
    };
    lab.querySelectorAll('.lab-table-control.is-active').forEach(function (item) { item.classList.remove('is-active'); });
    control.classList.add('is-active');
    tableMenu.innerHTML = '';
    var names = tableMenuTarget.kind === 'col'
      ? [['before', '在左侧插入列'], ['after', '在右侧插入列'], ['duplicate', '复制这一列'], ['delete', '删除这一列']]
      : [['before', '在上方插入行'], ['after', '在下方插入行'], ['duplicate', '复制这一行'], ['delete', '删除这一行']];
    names.forEach(function (entry) {
      var button = document.createElement('button');
      button.type = 'button';
      button.dataset.tableAction = entry[0];
      button.textContent = entry[1];
      if (entry[0] === 'delete') button.className = 'is-danger';
      tableMenu.appendChild(button);
    });
    tableMenu.style.left = Math.max(0, Math.min(tableFrame.clientWidth - 145, control.offsetLeft)) + 'px';
    tableMenu.style.top = (tableMenuTarget.kind === 'col' ? 2 : Math.max(0, control.offsetTop - 4)) + 'px';
    tableMenu.hidden = false;
  }

  function makeCellLike(source, text) {
    var cell = document.createElement(source.tagName.toLowerCase());
    cell.textContent = text;
    return cell;
  }

  function insertColumn(index, after) {
    Array.from(table.rows).forEach(function (row, rowIndex) {
      var source = row.cells[Math.min(index, row.cells.length - 1)];
      var cell = makeCellLike(source, rowIndex === 0 ? '新列' : '—');
      var insertionIndex = Math.min(row.cells.length, index + (after ? 1 : 0));
      row.insertBefore(cell, row.cells[insertionIndex] || null);
    });
  }

  function duplicateColumn(index) {
    Array.from(table.rows).forEach(function (row) {
      var source = row.cells[index];
      if (source) row.insertBefore(source.cloneNode(true), source.nextSibling);
    });
  }

  function deleteColumn(index) {
    if (!table.rows[0] || table.rows[0].cells.length <= 1) {
      showToast('表格至少需要保留一列');
      return false;
    }
    Array.from(table.rows).forEach(function (row) {
      if (row.cells[index]) row.deleteCell(index);
    });
    return true;
  }

  function insertRow(index, after) {
    var source = table.rows[index];
    if (!source) return;
    var clone = source.cloneNode(true);
    Array.from(clone.cells).forEach(function (cell, cellIndex) {
      cell.textContent = cell.tagName === 'TH' ? '新标题' : '—';
      if (cellIndex === 0 && cell.tagName !== 'TH') cell.textContent = '新项目';
    });
    source.parentNode.insertBefore(clone, after ? source.nextSibling : source);
  }

  function duplicateRow(index) {
    var source = table.rows[index];
    if (source) source.parentNode.insertBefore(source.cloneNode(true), source.nextSibling);
  }

  function deleteRow(index) {
    if (table.rows.length <= 2) {
      showToast('请至少保留表头和一行内容');
      return false;
    }
    table.rows[index].remove();
    return true;
  }

  function runTableAction(action) {
    if (!tableMenuTarget) return;
    var kind = tableMenuTarget.kind;
    var index = tableMenuTarget.index;
    var changed = true;
    if (kind === 'col') {
      if (action === 'before') insertColumn(index, false);
      if (action === 'after') insertColumn(index, true);
      if (action === 'duplicate') duplicateColumn(index);
      if (action === 'delete') changed = deleteColumn(index);
    } else {
      if (action === 'before') insertRow(index, false);
      if (action === 'after') insertRow(index, true);
      if (action === 'duplicate') duplicateRow(index);
      if (action === 'delete') changed = deleteRow(index);
    }
    tableMenu.hidden = true;
    if (changed) {
      completeLesson('table');
      renderTableControls();
      showToast('表格结构已更新');
    }
  }

  function moveColumn(from, to) {
    if (from === to) return;
    Array.from(table.rows).forEach(function (row) {
      var moving = row.cells[from];
      var target = row.cells[to];
      if (!moving || !target) return;
      row.insertBefore(moving, from < to ? target.nextSibling : target);
    });
  }

  function moveRow(from, to) {
    if (from === to) return true;
    var moving = table.rows[from];
    var target = table.rows[to];
    if (!moving || !target || moving.parentNode !== target.parentNode) {
      showToast('表头与正文行需要分别排序');
      return false;
    }
    target.parentNode.insertBefore(moving, from < to ? target.nextSibling : target);
    return true;
  }

  function addTablePart(kind) {
    if (kind === 'col') insertColumn(table.rows[0].cells.length - 1, true);
    if (kind === 'row') insertRow(table.rows.length - 1, true);
    completeLesson('table');
    renderTableControls();
    showToast(kind === 'col' ? '已新增一列' : '已新增一行');
  }

  function selectCommentTarget(element, focusInput) {
    if (!element) return;
    doc.querySelectorAll('.lab-selectable.is-selected').forEach(function (item) { item.classList.remove('is-selected'); });
    selectedBlock = element;
    element.classList.add('is-selected');
    var text = (element.querySelector('h3, strong, p') || element).textContent.trim().replace(/\s+/g, ' ');
    commentTarget.textContent = text.slice(0, 42);
    commentTarget.dataset.target = element.dataset.demoId || '';
    commentComposer.hidden = false;
    if (focusInput) window.setTimeout(function () { commentInput.focus(); }, 0);
  }

  function startGeneralComment() {
    commentTarget.textContent = '通用批注 · 不绑定元素';
    commentTarget.dataset.target = '';
    commentComposer.hidden = false;
    commentInput.focus();
  }

  function saveComment() {
    var value = commentInput.value.trim();
    if (!value) {
      flash(commentInput);
      commentInput.focus();
      return;
    }
    comments.unshift({
      author: '你',
      text: value,
      ref: commentTarget.textContent,
      target: commentTarget.dataset.target || ''
    });
    commentInput.value = '';
    commentComposer.hidden = true;
    renderComments();
    completeLesson('comments');
    showToast('批注已保存，并保留元素定位');
  }

  function renderComments() {
    commentList.replaceChildren();
    comments.forEach(function (comment) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'lab-comment-item';
      item.dataset.commentTarget = comment.target;
      var meta = document.createElement('div');
      meta.className = 'lab-comment-meta';
      var author = document.createElement('span');
      author.className = 'lab-comment-author';
      author.textContent = comment.author;
      meta.appendChild(author);
      var ref = document.createElement('span');
      ref.className = 'lab-comment-ref';
      ref.textContent = comment.ref || '通用批注';
      var text = document.createElement('div');
      text.className = 'lab-comment-text';
      text.textContent = comment.text;
      item.append(meta, ref, text);
      commentList.appendChild(item);
    });
    commentCount.textContent = String(comments.length);
  }

  async function copyShareLink() {
    var value = shareUrl.value;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        shareUrl.select();
        document.execCommand('copy');
        shareUrl.setSelectionRange(0, 0);
      }
    } catch (error) {
      shareUrl.select();
    }
    completeLesson('share');
    shareCopy.textContent = '已复制';
    showToast('示例房间链接已复制');
    window.setTimeout(function () { shareCopy.textContent = '复制'; }, 1400);
  }

  function showExportPreview(kind) {
    exportPopover.hidden = true;
    if (kind === 'html') {
      exportPreviewTitle.textContent = '干净 HTML 预览';
      exportPreviewText.textContent = '<!DOCTYPE html>\n<html lang="zh-CN">\n  <head><title>协作页面</title></head>\n  <body>\n    <section class="hero">\n      <h1>一起完成更好的 HTML</h1>\n    </section>\n  </body>\n</html>';
    } else {
      exportPreviewTitle.textContent = '交给 AI 的 Markdown 预览';
      exportPreviewText.textContent = '# HTML 修改任务\n\n请根据以下批注优化页面，并返回完整 HTML。\n\n## 定位批注\n- [标题模块] 标题可以再明确一点，突出协作价值。\n\n## 当前 HTML\n```html\n<section class="hero">...</section>\n```';
    }
    exportPreview.hidden = false;
    completeLesson('export');
  }

  lab.addEventListener('click', function (event) {
    var lessonButton = event.target.closest('.lab-lesson');
    if (lessonButton) {
      selectLesson(lessonButton.dataset.lesson);
      return;
    }
    if (event.target.closest('#lab-lesson-action')) {
      focusActiveLesson();
      return;
    }
    if (event.target.closest('#lab-progress-reset')) {
      completed.clear();
      saveProgress();
      updateProgress();
      showToast('学习进度已重置');
      return;
    }

    var modeButton = event.target.closest('.lab-mode-btn');
    if (modeButton) {
      closeTopPopovers();
      setMode(modeButton.dataset.mode, true);
      return;
    }

    var shareButton = event.target.closest('#lab-share-button');
    if (shareButton) {
      if (sharePopover.hidden) openSharePopover(); else closeTopPopovers();
      return;
    }
    var exportButton = event.target.closest('#lab-export-button');
    if (exportButton) {
      if (exportPopover.hidden) openExportPopover(); else closeTopPopovers();
      return;
    }
    if (event.target.closest('#lab-share-copy')) {
      copyShareLink();
      return;
    }
    var exportChoice = event.target.closest('[data-export-kind]');
    if (exportChoice) {
      showExportPreview(exportChoice.dataset.exportKind);
      return;
    }
    if (event.target.closest('#lab-export-preview-close')) {
      exportPreview.hidden = true;
      return;
    }

    var toolButton = event.target.closest('[data-tool-action]');
    if (toolButton) {
      runToolAction(toolButton.dataset.toolAction);
      return;
    }
    var addChoice = event.target.closest('[data-add-kind]');
    if (addChoice) {
      addDemoContent(addChoice.dataset.addKind);
      return;
    }
    var styleChoice = event.target.closest('[data-style]');
    if (styleChoice) {
      applyDemoStyle(styleChoice.dataset.style);
      return;
    }

    var tableModeButton = event.target.closest('[data-table-mode]');
    if (tableModeButton) {
      var nextTableMode = tableModeButton.dataset.tableMode;
      setMode(nextTableMode === 'drag' ? 'drag' : 'edit', false);
      setTableMode(nextTableMode);
      return;
    }
    var tableAdd = event.target.closest('[data-table-add]');
    if (tableAdd) {
      addTablePart(tableAdd.dataset.tableAdd);
      return;
    }
    var tableControl = event.target.closest('.lab-table-control');
    if (tableControl) {
      if (tableMode === 'edit') openTableMenu(tableControl);
      return;
    }
    var tableAction = event.target.closest('[data-table-action]');
    if (tableAction) {
      runTableAction(tableAction.dataset.tableAction);
      return;
    }

    if (event.target.closest('#lab-general-comment')) {
      startGeneralComment();
      return;
    }
    if (event.target.closest('#lab-comment-save')) {
      saveComment();
      return;
    }
    var commentItem = event.target.closest('.lab-comment-item');
    if (commentItem) {
      var targetId = commentItem.dataset.commentTarget;
      var targetElement = targetId ? doc.querySelector('[data-demo-id="' + targetId + '"]') : null;
      if (targetElement) {
        targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flash(targetElement);
      }
      return;
    }

    if (event.target.closest('#lab-toast-undo')) {
      var undo = undoAction;
      toast.hidden = true;
      undoAction = null;
      if (undo) undo();
      return;
    }

    var selectable = event.target.closest('.lab-selectable');
    if (selectable && doc.contains(selectable)) {
      if (mode === 'edit') selectBlock(selectable);
      if (mode === 'comment') selectCommentTarget(selectable, true);
      if (mode === 'view' && selectable.classList.contains('is-linked')) showToast('阅读模式会打开该模块绑定的链接');
      return;
    }

    if (!event.target.closest('.lab-action-wrap')) closeTopPopovers();
    if (!event.target.closest('#lab-floating-tools') && !event.target.closest('#lab-table-menu')) closeInlineMenus();
  });

  lab.addEventListener('dragstart', function (event) {
    var control = event.target.closest('.lab-table-control');
    if (control && tableMode === 'drag') {
      draggedSegment = { kind: control.dataset.tableKind, index: Number(control.dataset.tableIndex) };
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedSegment.kind + ':' + draggedSegment.index);
      control.classList.add('is-active');
      return;
    }
    var block = event.target.closest('.lab-reorderable');
    if (block && mode === 'drag') {
      draggedBlock = block;
      block.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', 'block');
    }
  });

  lab.addEventListener('dragover', function (event) {
    var control = event.target.closest('.lab-table-control');
    if (control && draggedSegment && control.dataset.tableKind === draggedSegment.kind) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      return;
    }
    var block = event.target.closest('.lab-reorderable');
    if (block && draggedBlock && block !== draggedBlock) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  });

  lab.addEventListener('drop', function (event) {
    var control = event.target.closest('.lab-table-control');
    if (control && draggedSegment && control.dataset.tableKind === draggedSegment.kind) {
      event.preventDefault();
      var to = Number(control.dataset.tableIndex);
      var moved = draggedSegment.kind === 'col'
        ? (moveColumn(draggedSegment.index, to), true)
        : moveRow(draggedSegment.index, to);
      draggedSegment = null;
      renderTableControls();
      if (moved) {
        completeLesson('table');
        showToast('已调整表格顺序');
      }
      return;
    }
    var targetBlock = event.target.closest('.lab-reorderable');
    if (targetBlock && draggedBlock && targetBlock !== draggedBlock) {
      event.preventDefault();
      var rect = targetBlock.getBoundingClientRect();
      var after = event.clientY > rect.top + rect.height / 2;
      targetBlock.parentNode.insertBefore(draggedBlock, after ? targetBlock.nextSibling : targetBlock);
      completeLesson('modes');
      showToast('模块顺序已调整');
    }
  });

  lab.addEventListener('dragend', function () {
    if (draggedBlock) draggedBlock.classList.remove('is-dragging');
    draggedBlock = null;
    draggedSegment = null;
    renderTableControls();
  });

  commentInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      saveComment();
    }
  });

  doc.addEventListener('input', function (event) {
    if (event.target.closest('.lab-editable')) {
      statusMessage.textContent = '保存中…';
      window.setTimeout(function () { statusMessage.textContent = '已保存'; }, 450);
    }
  });

  renderComments();
  renderTableControls();
  updateProgress();
  selectBlock(doc.querySelector('[data-demo-id="card-a"]'));
  selectLesson('modes');
}());
