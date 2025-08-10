package main

import (
	"bufio"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Vector []float64
type Similarity struct {
	Word  string
	Score float64
}

func main() {
	// Dispatch based on the subcommand (the first argument)
	if len(os.Args) < 2 {
		log.Println("Expected 'split' or 'prune' subcommands.")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "split":
		runSplit(os.Args[2:])
	case "prune":
		runPrune(os.Args[2:])
	default:
		log.Println("Expected 'split' or 'prune' subcommands.")
		os.Exit(1)
	}
}

// --- SPLIT SUBCOMMAND ---

func runSplit(args []string) {
	splitCmd := flag.NewFlagSet("split", flag.ExitOnError)
	inputFile := splitCmd.String("input", "", "Path to the large GloVe file to split.")
	linesPerChunk := splitCmd.Int("lines", 100000, "Number of lines per output chunk file.")
	splitCmd.Parse(args)

	if *inputFile == "" {
		log.Fatal("Error: -input flag is required for split command.")
	}

	log.Printf("Splitting file %s into chunks of %d lines...\n", *inputFile, *linesPerChunk)
	splitFile(*inputFile, *linesPerChunk)
	log.Println("Done splitting.")
}

func splitFile(filePath string, linesPerChunk int) {
	file, err := os.Open(filePath)
	if err != nil {
		log.Fatalf("Error opening input file: %v", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	lineCount := 0
	fileCount := 1
	var outFile *os.File
	var writer *bufio.Writer

	base := strings.TrimSuffix(filePath, filepath.Ext(filePath))

	for scanner.Scan() {
		if lineCount%linesPerChunk == 0 {
			if writer != nil {
				writer.Flush()
				outFile.Close()
			}
			outFileName := fmt.Sprintf("%s_part_%d.txt", base, fileCount)
			outFile, err = os.Create(outFileName)
			if err != nil {
				log.Fatalf("Error creating output file %s: %v", outFileName, err)
			}
			writer = bufio.NewWriter(outFile)
			log.Printf("Creating %s...", outFileName)
			fileCount++
		}
		writer.WriteString(scanner.Text() + "\n")
		lineCount++
	}

	if writer != nil {
		writer.Flush()
		outFile.Close()
	}
}

// --- PRUNE SUBCOMMAND ---

func runPrune(args []string) {
	pruneCmd := flag.NewFlagSet("prune", flag.ExitOnError)
	inputFile := pruneCmd.String("input", "", "Path to the full GloVe vector file.")
	vocabFile := pruneCmd.String("vocab", "", "Path to the vault vocabulary file.")
	outputFile := pruneCmd.String("output", "pruned_vectors.txt", "Path for the final pruned output file.")
	threshold := pruneCmd.Float64("threshold", 0.0, "Similarity threshold for including neighbors (0 to 1).")
	cap := pruneCmd.Int("cap", 100000, "Hard vocabulary cap for the final file.")
	neighbors := pruneCmd.Int("neighbors", 5, "Number of closest neighbors to consider.")
	pruneCmd.Parse(args)

	if *inputFile == "" || *vocabFile == "" {
		log.Fatal("Error: -input and -vocab flags are required for prune command.")
	}

	// The rest of the pruning logic is the same as before
	log.Println("Loading full GloVe model...")
	fullGloveMap := loadGloveModel(*inputFile)
	log.Printf("-> Loaded %d total vectors.\n", len(fullGloveMap))

	log.Println("Loading vault vocabulary...")
	vaultVocab := loadVocabulary(*vocabFile)
	log.Printf("-> Found %d unique words in vault.\n", len(vaultVocab))

	log.Println("Finding neighbors for vault words...")
	neighborVocab := findNeighborsConcurrently(vaultVocab, fullGloveMap, *neighbors, *threshold)
	log.Printf("-> Found %d unique neighbors (after de-duplication).\n", len(neighborVocab))

	// ... (rest of the pruning and writing logic is identical to the previous script) ...
	// ... (I've included it here for completeness)

	finalVocab := make(map[string]bool)
	for word := range vaultVocab {
		finalVocab[word] = true
	}
	for word := range neighborVocab {
		if !finalVocab[word] {
			finalVocab[word] = true
		}
	}
	log.Printf("Combined vocabulary size before pruning: %d words.\n", len(finalVocab))
	if len(finalVocab) > *cap {
		log.Printf("Size exceeds cap of %d. Pruning neighbors randomly...\n", *cap)
		neighborsToKeep := *cap - len(vaultVocab)
		if neighborsToKeep < 0 {
			neighborsToKeep = 0
		}
		neighborList := make([]string, 0, len(neighborVocab))
		for word := range neighborVocab {
			neighborList = append(neighborList, word)
		}
		rand.Seed(time.Now().UnixNano())
		rand.Shuffle(len(neighborList), func(i, j int) {
			neighborList[i], neighborList[j] = neighborList[j], neighborList[i]
		})
		finalVocab = make(map[string]bool)
		for word := range vaultVocab {
			finalVocab[word] = true
		}

		for i := 0; i < neighborsToKeep && i < len(neighborList); i++ {
			finalVocab[neighborList[i]] = true
		}
		log.Printf("-> Pruned vocabulary down to %d total words.\n", len(finalVocab))
	}
	log.Printf("Writing final pruned file to %s...\n", *outputFile)
	writePrunedFile(*inputFile, *outputFile, finalVocab)
	log.Println("Done!")
}


// --- SHARED HELPER FUNCTIONS ---

func loadGloveModel(filePath string) map[string]Vector {
	file, err := os.Open(filePath)
	if err != nil {
		log.Fatalf("Error opening GloVe file: %v", err)
	}
	defer file.Close()
	gloveMap := make(map[string]Vector)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		parts := strings.Fields(scanner.Text())
		word := parts[0]
		vec := make(Vector, len(parts)-1)
		for i, v := range parts[1:] {
			vec[i], _ = strconv.ParseFloat(v, 64)
		}
		gloveMap[word] = vec
	}
	return gloveMap
}

func loadVocabulary(filePath string) map[string]bool {
	file, err := os.Open(filePath)
	if err != nil {
		log.Fatalf("Error opening vocabulary file: %v", err)
	}
	defer file.Close()
	vocab := make(map[string]bool)
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		vocab[strings.TrimSpace(scanner.Text())] = true
	}
	return vocab
}

func cosineSimilarity(vecA, vecB Vector) float64 {
	var dotProduct, normA, normB float64
	for i := range vecA {
		dotProduct += vecA[i] * vecB[i]
		normA += vecA[i] * vecA[i]
		normB += vecB[i] * vecB[i]
	}
	if normA == 0 || normB == 0 {
		return 0.0
	}
	return dotProduct / (math.Sqrt(normA) * math.Sqrt(normB))
}

func findNeighborsConcurrently(vaultVocab map[string]bool, fullGloveMap map[string]Vector, topN int, threshold float64) map[string]bool {
	var wg sync.WaitGroup
	var mutex sync.Mutex
	neighborVocab := make(map[string]bool)
	jobs := make(chan string, len(vaultVocab))
	numWorkers := runtime.NumCPU()
	for i := 0; i < numWorkers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for vaultWord := range jobs {
				vaultVec, ok := fullGloveMap[vaultWord]
				if !ok {
					continue
				}
				similarities := make([]Similarity, 0, len(fullGloveMap))
				for gloveWord, gloveVec := range fullGloveMap {
					if gloveWord != vaultWord {
						sim := cosineSimilarity(vaultVec, gloveVec)
						if sim >= threshold {
							similarities = append(similarities, Similarity{Word: gloveWord, Score: sim})
						}
					}
				}
				sort.Slice(similarities, func(i, j int) bool {
					return similarities[i].Score > similarities[j].Score
				})
				mutex.Lock()
				for i := 0; i < topN && i < len(similarities); i++ {
					neighborVocab[similarities[i].Word] = true
				}
				mutex.Unlock()
			}
		}()
	}
	for word := range vaultVocab {
		jobs <- word
	}
	close(jobs)
	wg.Wait()
	return neighborVocab
}

func writePrunedFile(inputFile, outputFile string, finalVocab map[string]bool) {
	inFile, err := os.Open(inputFile)
	if err != nil {
		log.Fatalf("Error opening GloVe file for writing: %v", err)
	}
	defer inFile.Close()
	outFile, err := os.Create(outputFile)
	if err != nil {
		log.Fatalf("Error creating output file: %v", err)
	}
	defer outFile.Close()
	writer := bufio.NewWriter(outFile)
	scanner := bufio.NewScanner(inFile)
	for scanner.Scan() {
		line := scanner.Text()
		word := strings.SplitN(line, " ", 2)[0]
		if finalVocab[word] {
			writer.WriteString(line + "\n")
		}
	}
	writer.Flush()
}