$(document).ready(function() {
  $.getJSON('/api/data', function(data) {
    const columns = Object.keys(data[0] || {}).map(key => ({ title: key, data: key }));
    $('#fundingTable').DataTable({ data, columns });
    // 显示数据获取时间
    const now = new Date();
    // toLocaleString 会根据用户本地时区（如亚洲/东京）格式化
    $('#fetchTime').text('数据获取时间：' + now.toLocaleString());
  });
  
  setTimeout(() => location.reload(), 300 * 1000); // 30 分钟刷新
});