var Sequelize = require('sequelize')
  , async = require('async')
  , fs = require('fs')
  , changeCase = require('change-case');

module.exports = (function(){
  var AutoSequelize = function(database, username, password, options) {
    this.sequelize = new Sequelize(database, username, password, options || {});
    this.queryInterface = this.sequelize.getQueryInterface();
    this.options = {};
  }

  AutoSequelize.prototype.run = function(options, callback) {
    var self = this
      , text = {}
      , tableOptions = {}
      , isBaseTable = {}
      , hasSubTables = false
      , subTables = {};

    if (typeof options === "function") {
      callback = options;
      options = {};
    }

    options.global = options.global || 'Sequelize';
    options.local = options.local || 'sequelize';
    options.spaces = options.spaces || false;
    options.indentation = options.indentation || 1;
    options.directory = options.directory || './models';

    self.options = options;

    this.queryInterface.showAllTables({raw: true})
    .error(function(err){
      console.log('ERR: ' + err);
    })
    .success(function(tables){
      var _tables = {};
      async.each(tables, function(table, _callback){
        var tableName = Array.isArray(table) ? table[0] : table;
        self.queryInterface.describeTable(tableName)
        .success(function(fields){
          var def = {
            fields: fields
          };
          if (typeof tableName == 'object') {
            def.tableName = tableName.tableName;
            def.schema = tableName.schema;
            tableName = tableName.tableName;
          } else {
            def.tableName = tableName;
          }
          if (options.camelCase) {
            tableName = changeCase.camelCase(tableName.replace(/\./g, '_'));
          }
          _tables[tableName] = def;
          if (!options.multiValued) {
            isBaseTable[tableName] = true;
            _callback(null);
          } else {
            self.queryInterface.isBaseTable(def.tableName, def.schema)
            .success(function(baseTable) {
              isBaseTable[tableName] = baseTable;
              hasSubTables = hasSubTables || !baseTable;
              _callback(null);
            });
          }
        });
      }, function(){
        var tableNames = Object.keys(_tables);
        async.each(tableNames, function(table, _callback){
          var fields = Object.keys(_tables[table].fields)
            , spaces = '';

          for (var x = 0; x < options.indentation; ++x) {
            spaces += (options.spaces === true ? ' ' : "\t");
          }

          text[table] = "/* jshint indent: " + options.indentation + " */\n\n";
          text[table] += "module.exports = function(sequelize, DataTypes) {\n";
          text[table] += spaces + "return sequelize.define('";
          text[table] += table + "', { \n";
          
          tableOptions[table] = spaces + "{\n";
          if (options.camelCase) {
            tableOptions[table] += spaces + spaces + "tableName: '";
            if (_tables[table].schema) {
              tableOptions[table] += _tables[table].schema + ".";            
            }
            tableOptions[table] += _tables[table].tableName + "',\n";
          }
          tableOptions[table] += spaces + spaces + "timestamps: false";
          
          fields.forEach(function(field, i){
            var origField = field;
            if (options.camelCase) {
              field = changeCase.camelCase(field);
            }
            text[table] += spaces + spaces + "'" + field + "': {\n";
            if (options.camelCase && field !== origField) {
              text[table] += spaces + spaces + spaces + "field: '" + origField + "',\n";
            }
            var fieldAttr = Object.keys(_tables[table].fields[origField]);
            // Serial key for postgres...
            var defaultVal = _tables[table].fields[origField].defaultValue;
            if (Sequelize.Utils._.isString(defaultVal) && defaultVal.toLowerCase().indexOf('nextval') !== -1 && defaultVal.toLowerCase().indexOf('regclass') !== -1) {
              text[table] += spaces + spaces + spaces + "type: DataTypes.INTEGER,\n";
              text[table] += spaces + spaces + spaces + "primaryKey: true\n";
            } else {
              // ENUMs for postgres...
              if (_tables[table].fields[origField].type === "USER-DEFINED" && !!_tables[table].fields[origField].special) {
                _tables[table].fields[origField].type = "ENUM(" + _tables[table].fields[origField].special.map(function(f){ return "'" + f + "'"; }).join(',') + ")";
              }

              fieldAttr.forEach(function(attr, x){
                // We don't need the special attribute from postgresql describe table..
                if (attr === "special") {
                  return true;
                }
                else if (attr === "allowNull") {
                  text[table] += spaces + spaces + spaces + attr + ": " + _tables[table].fields[origField][attr];
                }
                else if (attr === "defaultValue") {
                  var val_text = defaultVal;
                  if (Sequelize.Utils._.isString(defaultVal)) {
                    val_text = "'" + val_text + "'"
                  }
                  if(defaultVal === null) {
                    return true;
                  } else {
                    text[table] += spaces + spaces + spaces + attr + ": " + val_text;
                  }
                }
                else if (attr === "type" && _tables[table].fields[origField][attr].indexOf('ENUM') === 0) {
                  text[table] += spaces + spaces + spaces + attr + ": DataTypes." + _tables[table].fields[origField][attr];
                } else if (attr === "type"){

                  var _attr = _tables[table].fields[origField][attr].toLowerCase()
                  , val = "'" + _tables[table].fields[origField][attr] + "'";

                  if (_attr === "tinyint(1)" || _attr === "boolean") {
                    val = 'DataTypes.BOOLEAN';
                  }
                  else if (_attr.match(/^(smallint|mediumint|tinyint|int)/)) {
                    var length = _attr.match(/\(\d+\)/);
                    val = 'DataTypes.INTEGER' + (!!length ? length : '');
                  }
                  else if (_attr.match(/^bigint/)) {
                    val = 'DataTypes.BIGINT';
                  }
                  else if (_attr.match(/^string|varchar|varying/)) {
                    val = 'DataTypes.STRING';
                  }
                  else if (_attr.match(/text$/)) {
                    val = 'DataTypes.TEXT';
                  }
                  else if (_attr.match(/^(date|timestamp)/)) {
                    val = 'DataTypes.DATE';
                  }
                  else if (_attr.match(/^time/)) {
                    val = 'DataTypes.TIME';
                  }
                  else if (_attr.match(/^(float|decimal)/)) {
                    val = 'DataTypes.' + _attr.toUpperCase();
                  }

                  text[table] += spaces + spaces + spaces + attr + ": " + val;
                } else if (attr === 'multiValued') {                  
                  var val = _tables[table].fields[origField][attr];                  
                  val = changeCase.camelCase(val);                  
                  text[table] += spaces + spaces + spaces + attr + ": '" +
                      val + "'";
                  if (!subTables[table]) {
                    subTables[table] = [];
                  }
                  if (subTables[table].indexOf(val) === -1) {
                    subTables[table].push(val);
                  }
                } else {
                  var val = _tables[table].fields[origField][attr];
                  text[table] += spaces + spaces + spaces + attr + ": " +
                    (typeof val === "string" ? ("'" + val + "'") : val);
                }

                if ((x+1) < fieldAttr.length && fieldAttr[x+1] !== "special") {
                  text[table] += ",";
                }
                text[table] += "\n";
              });
            }

            text[table] += spaces + spaces + "}";
            if ((i+1) < fields.length) {
              text[table] += ",";
            }
            text[table] += "\n";
          });

          text[table] += spaces + "}";
          text[table] += ",\n" + tableOptions[table] + "\n" +  spaces + "}";
          
          if (subTables[table]) {
            text[table] += ", function(model) {\n";
            subTables[table].forEach(function(subTable) {
              text[table] += spaces + spaces +
                "model.multiValuedColumn(sequelize.import(__dirname + " +
                "'/impl/" + subTable + "'));\n";
            });
            text[table] += spaces + "}";
          }
          text[table] += ");\n};\n";
          
          _callback(null);
        }, function(){
          self.write(text, hasSubTables, isBaseTable, callback);
        });
      });
    });
  }

  AutoSequelize.prototype.write = function(attributes, hasSubTables, isBaseTable, callback) {
    var tables = Object.keys(attributes)
      , self = this
      , implDirectory = self.options.directory + '/impl';
    
    async.series([
      function(_callback){
        fs.lstat(self.options.directory, function(err, stat){
          if (err || !stat.isDirectory()) {
            fs.mkdir(self.options.directory, _callback);
          } else {
            _callback(null);
          }
        });
      },
      function(_callback) {
        if (!hasSubTables) {
          _callback(null);
          return;
        }
        fs.lstat(implDirectory, function(err, stat) {
          if (err || !stat.isDirectory()) {
            fs.mkdir(implDirectory, _callback);
          } else {
            _callback(null);
          }
        });
      }
    ], function(err){
      if (err) return callback(err);

      async.each(tables, function(table, _callback){
        fs.writeFile((isBaseTable[table] ? self.options.directory : implDirectory) + '/' + table + '.js', attributes[table], function(err){
          if (err) return _callback(err);
          _callback(null);
        });
      }, function(err){
        callback(err, null);
      });
    });
  }

  return AutoSequelize;
})();
