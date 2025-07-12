$(document).ready(function() {
  $.getJSON('/api/combined-data', function(data) {
    // 显示获取时间
    $('#fetchTime').text('数据获取时间：' + new Date().toLocaleString());

    // 构建列定义并渲染表格
    const columns = Object.keys(data[0] || {}).map(key => ({ title: key, data: key }));
    $('#combinedTable').DataTable({ data, columns });
  });

  // 每30分钟刷新页面
  setTimeout(() => location.reload(), 1800 * 1000);
});