// Knockout.BindingConventions
// (c) Anders Malmgren - https://github.com/AndersMalmgren/Knockout.BindingConventions
// License: MIT (http://www.opensource.org/licenses/mit-license.php)
(function (window, ko) {
    if (window.ko === undefined) {
        throw "This library is dependant on Knockout";
    }

    String.prototype.endsWith = String.prototype.endsWith ? String.prototype.endsWith : function (suffix) {
        return this.indexOf(suffix, this.length - suffix.length) !== -1;
    };

    String.prototype.trim = String.prototype.trim || function () {
        return this.replace(/^\s+|\s+$/g, '');
    };

    var defaults = {
        roots: [window],
        excludeConstructorNames: ["Class"]
    };

    var prechecked = false;
    ko.bindingConventions = {
        init: function (options) {
            prechecked = false;
            ko.utils.extend(defaults, options);
        },
        conventionBinders: {}
    };

    ko.bindingConventions.ConventionBindingProvider = function () {

        this.orgBindingProvider = ko.bindingProvider.instance || new ko.bindingProvider();
        this.orgNodeHasBindings = this.orgBindingProvider.nodeHasBindings;
        this.attribute = "data-name";
        this.virtualAttribute = "ko name:";
    };

    ko.bindingConventions.ConventionBindingProvider.prototype = {
        getMemberName: function (node) {
            var name = null;

            if (node.nodeType === 1) {
                name = node.getAttribute(this.attribute);
            }
            else if (node.nodeType === 8) {
                var value = "" + node.nodeValue || node.text;
                var index = value.indexOf(this.virtualAttribute);

                if (index > -1) {
                    name = value.substring(index + this.virtualAttribute.length).trim();
                }
            }

            return name;
        },
        nodeHasBindings: function (node) {
            return this.orgNodeHasBindings(node) || this.getMemberName(node) !== null;
        },
        getBindingAccessors: function (node, bindingContext) {
            var name = this.getMemberName(node);

            var result = (name != null && node.nodeType === 8) ? null : this.orgBindingProvider.getBindingAccessors(node, bindingContext);
            if (name != null) {
                result = result || {};
                setBindingsByConvention(name, node, bindingContext, result);
            }

            return result;
        }
    };
    ko.bindingProvider.instance = new ko.bindingConventions.ConventionBindingProvider();

    var getDataFromComplexObjectQuery = function (name, context) {
        var parts = name.split(".");
        for (var i = 0; i < parts.length; i++) {
            context = context[parts[i]];
        }

        return context;
    };

    var setBindingsByConvention = function (name, element, bindingContext, bindings) {
        var dataFn = bindingContext[name] ?
                function() { return bindingContext[name]; } :
                function() { return bindingContext.$data[name]; };
        var data = dataFn();
        if (data === undefined) {
            dataFn = function() { return getDataFromComplexObjectQuery(name, bindingContext.$data); };
            data = dataFn();
        }
        if (data === undefined) {
            throw "Can't resolve member: " + name;
        }
        var unwrapped = ko.utils.peekObservable(data);
        var type = typeof unwrapped;
        var convention = element.__bindingConvention;

        if (convention === undefined) {
            for (var index in ko.bindingConventions.conventionBinders) {
                if (ko.bindingConventions.conventionBinders[index].rules !== undefined) {
                    convention = ko.bindingConventions.conventionBinders[index];
                    var should = true;
                    if (unwrapped == null && convention.deferredApplyIfDataNotSet === true) {
                        continue;
                    }

                    if (convention.rules.length == 1) {
                        should = convention.rules[0](name, element, bindings, unwrapped, type, data, bindingContext);
                    } else {
                        arrayForEach(convention.rules, function (rule) {
                            should = should && rule(name, element, bindings, unwrapped, type, data, bindingContext);
                        });
                    }

                    if (should) {
                        element.__bindingConvention = convention;
                        break;
                    }
                }
            }
        }
        if (element.__bindingConvention === undefined && unwrapped != null) throw "No convention was found for " + name;
        if (element.__bindingConvention !== undefined) {
            element.__bindingConvention.apply(name, element, bindings, unwrapped, type, dataFn, bindingContext);
        } else if (unwrapped == null && ko.isObservable(data)) {
            // To support deferred bindings, we need to set up a one-time subscription to apply the binding later
            var deferSubscription = data.subscribe(function(newValue) {
                if (newValue != null) {
                    deferSubscription.dispose();
                    var bindings = {};
                    setBindingsByConvention(name, element, bindingContext, bindings);
                    ko.applyBindingAccessorsToNode(element, bindings, bindingContext);
                }
            });

        }
    };

    ko.bindingConventions.conventionBinders.button = {
        rules: [function (name, element, bindings, unwrapped, type) { return element.tagName === "BUTTON" && type === "function"; } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn, bindingContext) {
            bindings.click = dataFn;

            setBinding(bindings, 'enable', "can" + getPascalCased(name), bindingContext);
        }
    };

    ko.bindingConventions.conventionBinders.options = {
        rules: [function (name, element, bindings, unwrapped) { return element.tagName === "SELECT" && unwrapped.push; } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn, bindingContext) {
            bindings.options = dataFn;
            var selectedMemberFound = false;

            singularize(name, function (singularized) {
                var pascalCasedItemName = getPascalCased(singularized);
                if (setBinding(bindings, 'value', "selected" + pascalCasedItemName, bindingContext)) {
                    setBinding(bindings, 'enable', "canChangeSelected" + pascalCasedItemName, bindingContext);
                    selectedMemberFound = true;
                    return true;
                }
            });

            if (selectedMemberFound) return;

            var pascalCased = getPascalCased(name);
            setBinding(bindings, 'selectedOptions', "selected" + pascalCased, bindingContext);
            setBinding(bindings, 'enable', "canChangeSelected" + pascalCased, bindingContext);
        }
    };

    ko.bindingConventions.conventionBinders.input = {
        rules: [function (name, element) { return element.tagName === "INPUT" || element.tagName === "TEXTAREA"; } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn, bindingContext) {
            if (type === "boolean") {
                if (ko.utils.ieVersion === undefined) {
                    element.setAttribute("type", "checkbox");
                }
                bindings.checked = dataFn;
            } else {
                if (unwrapped === bindingContext.$data[name]) {
                    // If bound to a non-observable in the view model,
                    // create a writable computed to support writes back to the property
                    var data = ko.computed({
                        read: dataFn,
                        write: function(value) {
                            bindingContext.$data[name] = value;
                        },
                        disposeWhenNodeIsRemoved: element
                    });
                    bindings.value = function() { return data; };
                } else {
                    bindings.value = dataFn;
                }
            }

            setBinding(bindings, 'enable', "canChange" + getPascalCased(name), bindingContext);
        }
    };

    ko.bindingConventions.conventionBinders.visible = {
        rules: [function (name, element, bindings, unwrapped, type) { return type === "boolean" && element.tagName !== "INPUT"; } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn) {
            bindings.visible = dataFn;
        }
    };

    ko.bindingConventions.conventionBinders.text = {
        rules: [function (name, element, bindings, unwrapped, type) { return type !== "object" && type !== "boolean" && element.tagName !== "IMG" && element.tagName !== "INPUT" && element.tagName !== "TEXTAREA" && !nodeHasContent(element); } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn) {
            bindings.text = dataFn;
        },
        deferredApplyIfDataNotSet: true
    };

    ko.bindingConventions.conventionBinders["with"] = {
        rules: [function (name, element, bindings, unwrapped, type) {
            return (type === "object" || unwrapped === undefined) &&
            (unwrapped == null || unwrapped.push === undefined) &&
            nodeHasContent(element);
        } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn) {
            bindings["with"] = dataFn;
        }
    };

    ko.bindingConventions.conventionBinders.foreach = {
        rules: [function (name, element, bindings, unwrapped) { return unwrapped && unwrapped.push && nodeHasContent(element); } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn) {
            bindings.foreach = dataFn;
        }
    };

    ko.bindingConventions.conventionBinders.template = {
        rules: [function (name, element, bindings, unwrapped, type) { return type === "object" && !nodeHasContent(element); } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn) {
            bindings.template = function() {
                var actualModel = ko.unwrap(dataFn());
                var isArray = actualModel != null && actualModel.push !== undefined;
                var isDeferred = actualModel == null || (isArray && actualModel.length == 0);

                var template = null;
                if (!isDeferred) {
                    var className = actualModel ? findConstructorName(isArray ? actualModel[0] : actualModel) : undefined;
                    var modelEndsWith = "Model";
                    if (className != null && className.endsWith(modelEndsWith)) {
                        template = className.substring(0, className.length - modelEndsWith.length);
                        if (!template.endsWith("View")) {
                            template = template + "View";
                        }
                    }

                    if (template == null) {
                        throw "View name could not be found";
                    }
                }

                var binding = { name: template, 'if': actualModel };
                if (isArray) {
                    binding.foreach = actualModel;
                } else {
                    binding.data = actualModel;
                }
                return binding;
            };
        },
        deferredApplyIfDataNotSet: true
    };

    ko.bindingConventions.conventionBinders.image = {
        rules: [function (name, element, bindings, unwrapped, type) { return type === "string" && element.tagName === "IMG"; } ],
        apply: function (name, element, bindings, unwrapped, type, dataFn) {
            bindings.attr = function() {
                return { src: dataFn() };
            };
        },
        deferredApplyIfDataNotSet: true
    };

    var setBinding = function(bindings, bindingName, dataName, bindingContext) {
        if (bindingContext.$data[dataName] !== undefined) {
            return (bindings[bindingName] = function() {
                return bindingContext.$data[dataName];
            });
        }
    };

    var getPascalCased = function (text) {
        return text.substring(0, 1).toUpperCase() + text.substring(1);
    };

    var pluralEndings = [{ end: "ies", use: "y" }, "es", "s"];
    var singularize = function (name, callback) {
        var singularized = null;
        arrayForEach(pluralEndings, function (ending) {
            var append = ending.use;
            ending = ending.end || ending;
            if (name.endsWith(ending)) {
                singularized = name.substring(0, name.length - ending.length);
                singularized = singularized + (append || "");
                if (callback) {
                    return !callback(singularized);
                }

                return true;
            }
            return true;
        });

        return singularized;
    };

    var arrayForEach = function (array, action) {
        for (var i = 0; i < array.length; i++) {
            var result = action(array[i]);
            if (result === false) break;
        }
    };

    var nodeHasContent = function (node) {
        return (node.nodeType === 8 && node.nextSibling.nodeType === 1) ||
            (node.nodeType === 1 && node.innerHTML.trim() !== "");
    };

    var preCheckConstructorNames = function () {
        var flagged = [];
        var nestedPreCheck = function (root) {
            if (root == null || root.__fcnChecked || root === window) return;

            root.__fcnChecked = true;
            if (root.__fcnChecked === undefined) return;
            flagged.push(root);
            for (var index in root) {
                var item = root[index];
                if (item !== undefined && index.endsWith("Model") && typeof item === "function") {
                    item.__fcnName = index;
                }
                nestedPreCheck(item);
            }
        };

        arrayForEach(defaults.roots, function (root) {
            nestedPreCheck(root);
        });

        arrayForEach(flagged, function (flag) {
            delete flag.__fcnChecked;
        });
    };

    var findConstructorName = function (obj, isConstructor) {
        var constructor = isConstructor ? obj : obj.constructor;

        if (constructor.__fcnName !== undefined) {
            return constructor.__fcnName;
        }

        var funcNameRegex = /function (.{1,})\(/;
        var results = (funcNameRegex).exec(constructor.toString());
        var name = (results && results.length > 1) ? results[1] : undefined;
        var index;

        var excluded = false;
        arrayForEach(defaults.excludeConstructorNames, function (exclude) {
            if (exclude === name) {
                excluded = true;
                return false;
            }
            return true;
        });

        if (name === undefined || excluded) {
            var flagged = [];
            var nestedFind = function (root) {
                if (root == null ||
                    root === window.document ||
                    root === window.html ||
                    root === window.history || // fixes security exception
                    root === window.frameElement || // fixes security exception when placed in an iFrame
                    typeof root === "function" ||
                    root.__fcnChecked === true || // fixes circular references
                    (root.location && root.location != window.location) // fixes (i)frames
                ) {
                    return;
                }
                try {
                    root.__fcnChecked = true;
                } catch (err) {
                    return; // IE error
                }
                if (root.__fcnChecked === undefined) {
                    return;
                }
                flagged.push(root);

                for (index in root) {
                    var item = root[index];
                    if (item === constructor) {
                        return index;
                    }


                    var found = nestedFind(item);
                    if (found !== undefined) {
                        return found;
                    }
                }
            };

            arrayForEach(defaults.roots, function (root) {
                name = nestedFind(root);
                if (name !== undefined) {
                    return false;
                }
                return true;
            });

            for (index in flagged) {
                delete flagged[index].__fcnChecked;
            }
        }
        constructor.__fcnName = name;
        return name;
    };

    var orgApplyBindings = ko.applyBindings;
    ko.applyBindings = function (viewModel, element) {
        if (prechecked === false) {
            preCheckConstructorNames();
            prechecked = true;
        }

        orgApplyBindings(viewModel, element);
    };

    ko.bindingConventions.utils = {
        findConstructorName: findConstructorName,
        singularize: singularize,
        getPascalCased: getPascalCased,
        nodeHasContent: nodeHasContent,
        setBinding: setBinding
    };
})(window, ko);