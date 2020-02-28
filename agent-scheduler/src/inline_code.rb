#!/usr/bin/env ruby

PATTERN = %r{
  ^
  (?<indent>\s*)
  (?<key>\S+):
  \s+
  !InlineCode
  \s+
  (?<file>.+)
  $
}x

def inline_file(match)
  puts "#{match[:indent]}#{match[:key]}: |"

  file_name = match[:file]
  file_size = File.size(file_name)

  if file_size > 4096
  	raise "InlineCode files must be 4096 bytes or less for inlining, #{file_name} is #{file_size}"
  end

  File.open(file_name) do |f|
    f.each_line do |line|
      puts(match[:indent] + "  " + line)
    end
  end
end

File.open(ARGV[0]) do |template|
  template.each_line do |line|
    if match = PATTERN.match(line)
      inline_file(match)
    else
      puts line
    end
  end
end
