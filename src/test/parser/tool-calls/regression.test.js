import { expect } from "chai";
import { describe, it } from "mocha";
import { extractToolCallXMLParser } from "../../../utils/xmlUtils.js";

describe("Tool Call Extraction Regression Tests", function () {
  const knownToolNames = [
    "search",
    "run_code",
    "replace_string_in_file",
    "insert_edit_into_file",
    "think",
    "apply_patch",
  ];

  describe("HTML Content Preservation", function () {
    it("should preserve HTML content in tool parameters", function () {
      const content = `<insert_edit_into_file>
        <explanation>Add a responsive navbar</explanation>
        <filePath>/path/to/index.html</filePath>
        <code>
          <nav class="navbar navbar-expand-lg">
            <div class="container-fluid">
              <a class="navbar-brand" href="#">Brand</a>
              <button class="navbar-toggler" type="button" data-bs-toggle="collapse"
                      data-bs-target="#navbarNav" aria-controls="navbarNav"
                      aria-expanded="false" aria-label="Toggle navigation">
                <span class="navbar-toggler-icon"></span>
              </button>
              <div class="collapse navbar-collapse" id="navbarNav">
                <ul class="navbar-nav">
                  <li class="nav-item">
                    <a class="nav-link active" aria-current="page" href="#">Home</a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" href="#">Features</a>
                  </li>
                  <li class="nav-item">
                    <a class="nav-link" href="#">Pricing</a>
                  </li>
                </ul>
              </div>
            </div>
          </nav>
        </code>
      </insert_edit_into_file>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("insert_edit_into_file");
      expect(result.arguments).to.have.property(
        "explanation",
        "Add a responsive navbar",
      );
      expect(result.arguments).to.have.property(
        "filePath",
        "/path/to/index.html",
      );
      expect(result.arguments).to.have.property("code");

      expect(result.arguments.code).to.include('class="navbar-brand"');
      expect(result.arguments.code).to.include('aria-expanded="false"');

      expect(result.arguments.code).to.include('<ul class="navbar-nav">');
      expect(result.arguments.code).to.include("</ul>");
    });
  });

  describe("Code with XML-like tokens", function () {
    it("should correctly parse JavaScript with comparison operators", function () {
      const content = `<run_code>
        <language>javascript</language>
        <code>
          // Function to check if user is eligible
          function checkEligibility(age, income) {
            if (age >= 18 && age < 65) {
              if (income > 30000 && income <= 100000) {
                return true;
              } else if (income > 100000) {
                return "High income bracket";
              }
            }
            return false;
          }
          
          // Test the function
          console.log(checkEligibility(25, 50000)); // Should return true
          console.log(checkEligibility(17, 50000)); // Should return false
          console.log(checkEligibility(30, 150000)); // Should return "High income bracket"
        </code>
      </run_code>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("run_code");
      expect(result.arguments).to.have.property("language", "javascript");
      expect(result.arguments).to.have.property("code");

      expect(result.arguments.code).to.include("age >= 18 && age < 65");
      expect(result.arguments.code).to.include(
        "income > 30000 && income <= 100000",
      );
    });

    it("should correctly parse TypeScript with generic types", function () {
      const content = `<run_code>
        <language>typescript</language>
        <code>
          interface Dictionary<T> {
            [key: string]: T;
          }
          
          class Repository<T> {
            private items: Dictionary<T> = {};
            
            add(id: string, item: T): void {
              this.items[id] = item;
            }
            
            get(id: string): T | undefined {
              return this.items[id];
            }
            
            getAll(): Array<T> {
              return Object.values(this.items);
            }
          }
          
          // Test with a User type
          interface User {
            name: string;
            email: string;
          }
          
          const userRepo = new Repository<User>();
          userRepo.add("1", { name: "Alice", email: "alice@example.com" });
          userRepo.add("2", { name: "Bob", email: "bob@example.com" });
          
          console.log(userRepo.getAll());
        </code>
      </run_code>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("run_code");
      expect(result.arguments).to.have.property("language", "typescript");
      expect(result.arguments).to.have.property("code");

      expect(result.arguments.code).to.include("interface Dictionary<T>");
      expect(result.arguments.code).to.include("class Repository<T>");
      expect(result.arguments.code).to.include(
        "const userRepo = new Repository<User>()",
      );
    });
  });

  describe("Complex Tool Calls", function () {
    it("should correctly parse apply_patch tool with diff", function () {
      const content = `<apply_patch>
        <input>*** Begin Patch
*** Update File: /path/to/file.js
@@class Calculator
@@    calculate() {
-        return this.num1 + this.num2;
+        // Add validation before calculation
+        if (isNaN(this.num1) || isNaN(this.num2)) {
+            throw new Error("Invalid numbers");
+        }
+        return this.num1 + this.num2;
@@    }
*** End Patch</input>
      </apply_patch>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("apply_patch");
      expect(result.arguments).to.have.property("input");

      expect(result.arguments.input).to.include("*** Begin Patch");
      expect(result.arguments.input).to.include("*** Update File:");
      expect(result.arguments.input).to.include(
        "-        return this.num1 + this.num2;",
      );
      expect(result.arguments.input).to.include(
        "+        // Add validation before calculation",
      );
    });

    it("should correctly parse complex nested think tool", function () {
      const content = `<think>
        <thoughts>
          <issue>
            <name>Performance Bottleneck</name>
            <description>The application is experiencing slow response times during peak usage.</description>
          </issue>
          <analysis>
            <findings>
              <finding>Database queries are not optimized</finding>
              <finding>Missing index on frequently queried column</finding>
              <finding>N+1 query problem in the user listings</finding>
            </findings>
            <recommendations>
              <recommendation>Add appropriate indexes to the database</recommendation>
              <recommendation>Use eager loading for related records</recommendation>
              <recommendation>Implement query caching</recommendation>
            </recommendations>
          </analysis>
          <conclusion>
            The performance issues can be resolved by optimizing database access patterns and adding appropriate indexes.
          </conclusion>
        </thoughts>
      </think>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("think");
      expect(result.arguments).to.have.property("thoughts");

      expect(result.arguments.thoughts).to.include("Performance Bottleneck");
      expect(result.arguments.thoughts).to.include(
        "Database queries are not optimized",
      );
      expect(result.arguments.thoughts).to.include(
        "Missing index on frequently queried column",
      );
      expect(result.arguments.thoughts).to.include(
        "Add appropriate indexes to the database",
      );
      expect(result.arguments.thoughts).to.include(
        "The performance issues can be resolved",
      );
    });
  });

  describe("Multi-line Tool Handling", function () {
    it("should preserve line breaks in multi-line parameters", function () {
      const content = `<think>
        <thoughts>This is a multi-line thought.
        
Second paragraph of the thought.

- Item 1
- Item 2
- Item 3

Final paragraph with conclusion.</thoughts>
      </think>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("think");
      expect(result.arguments).to.have.property("thoughts");

      expect(result.arguments.thoughts).to.include(
        "This is a multi-line thought.",
      );
      expect(result.arguments.thoughts).to.include("Second paragraph");
      expect(result.arguments.thoughts).to.include("- Item 1");
      expect(result.arguments.thoughts).to.include(
        "Final paragraph with conclusion.",
      );
    });

    it("should handle excessive whitespace in tool parameters", function () {
      const content = `<search>
        
        
        <query>
          
          search term with lots of whitespace
          
          
        </query>
        
        
      </search>`;

      const result = extractToolCallXMLParser(content, knownToolNames);

      expect(result).to.not.be.null;
      expect(result.name).to.equal("search");
      expect(result.arguments).to.have.property("query");

      expect(result.arguments.query.trim()).to.equal(
        "search term with lots of whitespace",
      );
    });
  });
});
