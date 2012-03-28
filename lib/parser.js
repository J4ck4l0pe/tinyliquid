/**
 * 代码分析器
 *
 * @author 老雷<leizongmin@gmail.com>
 */
 
var utils = require('./utils');
var template = require('./template');


exports.output = function (text, start, context) {
  if (context.isRaw)
    return null;
  
  // 查找结束标记
  var end = text.indexOf(' }}', start);
  if (end === -1)
    return null;
  
  // 检查结束标记是否为同一行的
  var lineend = text.indexOf('\n', start);
  if (lineend > -1 && lineend < end)
    return null;
  
  var line = text.slice(start + 3, end).trim();
  end += 3;
  
  // 支持筛选器
  var script = '$_buf.push(' + utils.filtered(line) + ');';
  
  return {start: start, end: end, script: script};
}

 
exports.tags = function (text, start, context) {
  // 查找结束标记
  var end = text.indexOf(' %}', start);
  if (end === -1)
    return null;
  
  // 检查结束标记是否为同一行的
  var lineend = text.indexOf('\n', start);
  if (lineend > -1 && lineend < end)
    return null;
  
  var line = text.slice(start + 3, end).trim();
  end += 3;
  // console.log('Line: ' + line);
  
  // 解析语句
  var space_start = line.indexOf(' ');
  var script = '';
  
  // 设置行号，以便检查运行时错误
  var setLineNumber = function () {
    if (script.substr(-1) === '\n')
      script += '$_line_num = ' + context.line_num + ';\n';
    else
      script += '\n$_line_num = ' + context.line_num + ';\n';
  }
  
  // 当前在raw标记内，则只有遇到 enddraw 标记时才能终止
  if (context.isRaw) {
    if (line === 'endraw') {
      context.isRaw = false;
      setLineNumber();
      script += '/* endraw */';
      return {start: start, end: end, script: script};
    }
    else {
      return null;
    }
  }
  
  // 嵌套开始
  var enterLoop = function (name) {
    context.loop++;
    context.loopName.push({
      name:     name,
      start:    start,
      end:      end,
      line:     line,
      line_num: context.line_num
    });
  }
  
  // 退出嵌套
  var outLoop = function () {
    context.loop--;
    context.loopName.pop();
  }
  
  // 嵌套结束标记不匹配
  var loopNotMatch = function () {
    context.error = {
      message:    'Unexpected token: ' + line,
      start:      start,
      end:        end,
      line:       line
    }
  }
  
  // 意外的标记
  var syntaxError = function () {
    context.error = {
      message:    'SyntaxError: ' + line,
      start:      start,
      end:        end,
      line:       line
    }
  }
  
  // 无法识别的标记
  var unknowTag = function () {
    context.error = {
      message:    'UnknowTag: ' + line,
      start:      start,
      end:        end,
      line:       line
    }
  }
  
  // 当前嵌套名称
  if (context.loopName.length > 0)
    var loopName = context.loopName[context.loopName.length - 1].name;
  else
    var loopName = '';
  
  // 简单标记(一般为标记结尾)
  if (space_start === -1) {
    switch (line) {
      // raw 标记
      case 'raw':
        context.isRaw = true;
        setLineNumber();
        script += '/* raw */';
        break;
      // endif
      case 'endif':
        if (loopName !== 'if')
          loopNotMatch();
        else {
          setLineNumber();
          script += '}';
          outLoop();
        }
        break;
      // endunless
      case 'endunless':
        if (loopName !== 'unless')
          loopNotMatch();
        else {
          setLineNumber();
          script += '}';
          outLoop();
        }
        break;
      // else
      case 'else':
        if (loopName === 'if' || loopName === 'unless') {
          setLineNumber();
          script += '} else {';
          setLineNumber();
        }
        else if (loopName === 'case') {
          setLineNumber();
          script += 'break;\n' +
                    'default:';
          setLineNumber();
        }
        else
          loopNotMatch();
        break;
      // endcase
      case 'endcase':
        if (loopName !== 'case')
          loopNotMatch();
        else {
          setLineNumber();
          script += '}';
          outLoop();
        }
        break;
      // endfor
      case 'endfor':
        if (loopName !== 'for')
          loopNotMatch();
        else {
          setLineNumber();
          script += '}\n'
                  + '})($_merge(locals));';
          outLoop();
        }
        break;
      // endtablerow
      case 'endtablerow':
        if (loopName !== 'tablerow')
          loopNotMatch();
        else {
          setLineNumber();
          script += '}\n'
                  + '}\n'
                  + '})($_merge(locals));';
          outLoop();
        }
        break;
      // endcapture
      case 'endcapture':
        if (loopName !== 'capture')
          loopNotMatch();
        else {
          setLineNumber();
          script += '} catch (err) {\n'
                  + '  $_rethrow(err);\n'
                  + '}\n'
                  + 'return $_buf.join(\'\');\n'
                  + '})([]);';
          outLoop();
        }
        break;
      // 出错
      default:
        unknowTag();
    }
  }
  // 复杂标记(一般为标记开头)
  else {
    var line_left = line.substr(0, space_start);
    var line_right = line.substr(space_start).trim();
    switch (line_left) {
      // if / unless 判断
      case 'if':
        enterLoop(line_left);
        setLineNumber();
        script += 'if ' + utils.condition(line_right) + ' {';
        break;
      case 'unless':
        enterLoop(line_left);
        setLineNumber();
        script += 'if (!' + utils.condition(line_right) + ') {';
        break;
      // case 判断
      case 'case':
        enterLoop(line_left);
        setLineNumber();
        script += 'switch (' + utils.localsWrap(line_right) + ') {';
        break;
      case 'when':
        if (context.hasWhen)
          script += 'break;\n';
        if (loopName !== 'case')
          loopNotMatch();
        else {
          script += 'case ' + utils.localsWrap(line_right) + ':';
          setLineNumber();
          context.hasWhen = true;
        }
        break;  
      // for 循环
      case 'for':
        enterLoop(line_left);
        var s = utils.forloops(line_right, context.loop);
        if (s === null)
          syntaxError();
        else {
          setLineNumber();
          script += s;
        }
        break;
      // tablerow 循环
      case 'tablerow':
        enterLoop(line_left);
        var s = utils.tablerow(line_right, context.loop);
        if (s === null)
          syntaxError();
        else {
          setLineNumber();
          script += s;
        }
        break;
      // assign 定义变量
      case 'assign':
        var b = utils.split(line_right);
        if (b.length === 3 && b[1] === '=') {
          b[0] = utils.localsWrap(b[0]);
          b[2] = utils.localsWrap(b[2]);
          setLineNumber();
          script += 'global.' + b[0] + ' = ' + b[0] + ' = ' + b[2] + ';';
        }
        else {
          syntaxError();
        }
        break;
      // capture 定义变量块
      case 'capture':
        enterLoop(line_left);
        var n = utils.localsWrap(line_right);
        setLineNumber();
        script += 'global.' + n + ' = ' + n + ' = (function ($_buf) {\n'
                + 'try {\n'
                + '/* captures */\n';
        break;
      // 其他
      default:
        unknowTag();
    }
  }
  
  return {start: start, end: end, script: script}
}